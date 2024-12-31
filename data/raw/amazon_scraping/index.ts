import playwright from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { writeFile } from "fs/promises";
import type { Page } from "playwright";

const { chromium } = playwright;
chromium.use(stealth());

async function paginateProductList(page: Page) {
    let links: string[] = [];

    for (let i = 0; i < 100; ++i) {
        await page.waitForSelector(".s-pagination-container"); // ensure all products are loaded
        let linksNew = await page.locator(
            "css=div[data-cy='title-recipe'] a.a-text-normal"
        ).evaluateAll((links) => links.map(el => (el as HTMLAnchorElement).href));
        console.log(linksNew.length);
        links = [...links, ...linksNew];
        let nextButton = page.locator(".s-pagination-next");
        if (await nextButton.evaluate(el => el.classList.contains("s-pagination-disabled")))
            break;
        await nextButton.click();
    }
    return links.filter(link => !link.includes("sspa"));
}

async function getProductInfo(page: Page)
{
    const title = (await page.locator("#productTitle").textContent())?.trim();
    const [price_min, price_max] = await page.locator(".a-text-price .a-offscreen").evaluateAll(prices => {
        if (prices.length == 1)
            return [prices[0].textContent, prices[0].textContent];
        else if (prices.length >= 2)
            return [prices[0].textContent, prices[1].textContent];
        return [null, null];
    }).then(prices => prices.map(price => parseFloat(price!.replace("$", ""))));
    const rating_total = await page.locator("span[data-hook='total-review-count']").textContent()
        .then(num => parseInt(num!.replace(" global ratings", "").replace(",", "")))
        .catch(() => 0);
    const rating_percent = !rating_total ? null :
        (await page.locator("#histogramTable .a-text-right").evaluateAll(
            ratings => ratings.map(rating => [...rating.childNodes]
                .filter(e => e.nodeType == Node.TEXT_NODE)
                .map(e => parseInt(e.textContent!.replace("%", "")))
            )
        )).flat();
    const variants = await page.locator(".swatches img").evaluateAll(
        vars => vars.map(el => el.getAttribute("alt")!)
    );
    const product_details = Object.fromEntries(
        await page.locator(".product-facts-detail").evaluateAll(
            rows => rows.map(row => {
                const left = row.querySelector(".a-col-left")!.textContent!.trim();
                const right = row.querySelector(".a-col-right")!.textContent!.trim();
                return [left, right];
            })
        )
    );
    const product_about = (await page.locator(".product-facts-title + ul li").allTextContents())
        .join('\n');
    return {
        title, price_min, price_max,
        rating_total, rating_percent,
        variants, product_details, product_about
    }
}

chromium.launch({ headless: false }).then(async (browser) => {
    const page = await browser.newPage();
    await page.goto("https://www.amazon.com", { waitUntil: "load" });
    await page.waitForTimeout(10000);
    await page.goto(
        "https://www.amazon.com/s?i=specialty-aps&bbn=16225019011&rh=n%3A7141123011%2Cn%3A16225019011%2Cn%3A1040658&ref=nav_em__nav_desktop_sa_intl_clothing_0_2_13_2",
        {
            waitUntil: "load"
        }
    );
    const products = await paginateProductList(page);
    const productInfos = [];
    for (const product of products)
    {
        try {
            await page.goto(product, { waitUntil: "load" });
            const productInfo = await getProductInfo(page);
            console.log(productInfo);
            productInfos.push(productInfo);
        }
        catch (e) {
            console.error(`Failed to get product info for ${product}`)
            console.error(e);
        }
    }   

    await browser.close();
    console.log("Writing file...");
    await writeFile(`./products-${Date.now()}.json`, JSON.stringify(productInfos));
    console.log("Done!");
})