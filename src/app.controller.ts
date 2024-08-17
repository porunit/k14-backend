import { Controller, Get, OnModuleInit, Param, Query, Res } from "@nestjs/common";
import { AppService } from "./app.service";
import puppeteer, { Browser, Page } from "puppeteer";
import * as cheerio from "cheerio";
import axios from "axios";

const ORIGIN = "https://maksim-zakharov.github.io";
const FRONTEND_NAME = "mobile-de-frontend";

async function createBrowser() {
  return puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
}

async function createPage(browser: Browser) {
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
  );

  return page;
}


const fromTo = (from: string, to: string) => {
  if (from === "null") {
    from = "";
  }

  if (to === "null") {
    to = "";
  }

  return from && to
    ? encodeURIComponent(`${from}:${to}`)
    : from
      ? encodeURIComponent(`${from}:`)
      : to
        ? encodeURIComponent(`:${to}`)
        : "";
};

const getCheerio = async (page: Page) => {
  const content = await page.content();
  const $ = cheerio.load(content);
  return { content, $ };
};

const goto = (page: Page, url: string) =>
  page.goto(url, { waitUntil: "networkidle2" });

const EUR_RUB = 100;

async function extractTextContent(page) {
  const { $ } = await getCheerio(page);

  const LIST_ITEMS_SELECTOR =
    "[data-testid=\"result-list-container\"] a[data-testid^=\"result-listing-\"]";
  const TOTAL_COUNT_SELECTOR = "[data-testid=\"srp-title\"]";

  const lastButtonText = $(TOTAL_COUNT_SELECTOR).text();
  const totalCount = parseInt(lastButtonText.split(" ")[0].replace(".", ""));
  const listItemsElements = $(LIST_ITEMS_SELECTOR);

  const items = listItemsElements
    .map((index, element) => {
      const url = $(element).attr("href");
      const searchParams = new URLSearchParams(url.split("?")[1]);
      const id = searchParams.get("id");

      const detailsElement = $(element).find(
        "[data-testid=\"listing-details-attributes\"]"
      );
      const detailsText = detailsElement.text();

      const [date, mileage] = detailsText.split(" • ");

      const power = parseInt(detailsText.match(/(\d+) PS/gm)?.[0]?.split(" PS")?.[0] || "0");

      const titleElement = $(element).find("h2");
      const titleText = titleElement.text();

      const priceElement = $(element).find("[data-testid=\"price-label\"]");
      const priceText = priceElement.text();

      const imgElements = $(element).find(
        "[data-testid^=\"result-listing-image-\"]"
      );
      const imgUrls = imgElements
        .map((i, imgElement) => imgElement.attribs["src"])
        .get();

      return {
        id,
        url: `https://suchen.mobile.de${url}`,
        date,
        power,
        mileage: parseInt(mileage.split(" ")[0].replace(".", "")),
        title: titleText,
        price: parseInt(priceText.split(" ")[0].replace(".", "")) * EUR_RUB,
        imgUrls,
        detailsText
      };
    })
    .get();

  return { items, totalCount };
}

@Controller()
export class AppController implements OnModuleInit {
  private _browser: Browser;
  private _pageMap = {};

  private brandModelsMap = {};

  private _brands;

  constructor(private readonly appService: AppService) {
  }

  onModuleInit(): any {
    // createBrowser().then((browser) => (this._browser = browser));
  }

  @Get("/")
  async getStatic(@Res() res) {
    const response = await axios.get(`${ORIGIN}/${FRONTEND_NAME}/`, {
      responseType: "stream"
    });
    // Object.entries(response.headers).map(([key, header]) => res.set(key, header));
    response.data.pipe(res);
  }

  @Get(`/:path`)
  async getAsset(@Param("path") path: string, @Res() res) {
    const response = await axios.get(`${ORIGIN}/${FRONTEND_NAME}/${path}`, {
      responseType: "stream"
    });
    // Object.entries(response.headers).map(([key, header]) => res.set(key, header));
    res.set("content-type", response.headers["content-type"]);
    response.data.pipe(res);
  }

  @Get(`/assets/:path`)
  async getCSS(@Param("path") path: string, @Res() res) {
    const response = await axios.get(
      `${ORIGIN}/${FRONTEND_NAME}/assets/${path}`,
      {
        responseType: "stream"
      }
    );

    res.set("content-type", response.headers["content-type"]);

    // Object.entries(response.headers).map(([key, header]) => res.set(key, header));
    response.data.pipe(res);
  }

  async preparePage(name: string, userId?: string): Promise<Page> {
    if (!this._browser) {
      this._browser = await createBrowser();
    }

    let key = name;
    if (userId) {
      key = `${name}-${userId}`;
    }

    if (!this._pageMap[key]) {
      this._pageMap[key] = await createPage(this._browser);
    }

    return this._pageMap[key];
  }

  @Get("/api/colors")
  async getColors() {
    const page = await this.preparePage("main");

    await goto(page, "https://suchen.mobile.de/fahrzeuge/detailsuche/");

    const { $ } = await getCheerio(page);

    return $("[data-testid^=\"exterior-color-\"]")
      .map((i, el) => el.attribs["value"])
      .get();
  }

  @Get("/api/brands")
  async getBrands() {
    if (this._brands) {
      return this._brands;
    }

    const page = await this.preparePage("main");

    await goto(page, "https://www.mobile.de");

    const { $ } = await getCheerio(page);

    const OPTION_SELECTOR = "[data-testid=\"qs-select-make\"] option";

    this._brands = $(OPTION_SELECTOR)
      .map((i, el) => ({ value: $(el).attr("value"), label: $(el).text() }))
      .get()
      .filter((r) => !!r.value);

    return this._brands;
  }

  @Get("/api/models")
  async getModels(@Query() query) {
    const {
      brand
    }: {
      brand?: string;
    } = query;

    if (!brand) {
      return [];
    }

    if (this.brandModelsMap[brand]) {
      return this.brandModelsMap[brand];
    }

    const page = await this.preparePage("api");

    await goto(page, "https://www.mobile.de");

    const modelsResult = await page.evaluate((selectedBrand) => {
      return fetch(
        `https://m.mobile.de/consumer/api/search/reference-data/models/${selectedBrand}`
      ).then((res) => res.json());
    }, brand);

    if (modelsResult.data?.length > 0) {
      this.brandModelsMap[brand] = modelsResult.data;
    }

    return modelsResult.data; // .filter((r) => !!r.value);
  }

  @Get("/api/cars/count")
  async getCarsCount(@Query() query) {
    let {
      yearFrom,
      yearTo,
      pwFrom,
      pwTo,
      priceFrom,
      priceTo,
      mileageFrom,
      mileageTo,
      page,
      model,
      brand,
      sort,
      order, // asc / desc
      userId
    }: any = query;

    if (priceFrom) priceFrom = parseInt(priceFrom) / EUR_RUB;
    if (priceTo) priceTo = parseInt(priceTo) / EUR_RUB;
    // Мощность
    if (pwFrom) pwFrom = Math.floor(parseInt(pwFrom) / 1.36);
    if (pwTo) pwFrom = Math.floor(parseInt(pwTo) / 1.36);

    const queryParamsMap = {
      dam: "false",
      ref: "quickSearch",
      s: "Car",
      // По какому полю сортировать
      sb: sort || "rel",
      // Сортировка в какую сторону - up / down
      od: order ? (order === "asc" ? "up" : "down") : "",
      vc: "Car",
      pw: fromTo(pwFrom, pwTo),
      p: fromTo(priceFrom, priceTo), // `%253A${priceTo}`,
      ms: encodeURIComponent(`${brand};${model};;`),
      ml: fromTo(mileageFrom, mileageTo), // `%253A${mileageTo}`,
      isSearchRequest: "true",
      pageNumber: page,
      fr: fromTo(yearFrom, yearTo) // 2018%3A2020
    };

    const browserPage = await this.preparePage("api");

    await goto(browserPage, "https://www.mobile.de");

    const modelsResult = await browserPage.evaluate((queryParamsMap) => {
      const str = Object.entries(queryParamsMap).map(([k, v]) => `${k}=${v}`).join("&");
      return fetch(
        `https://m.mobile.de/consumer/api/search/hit-count?${str}`
      ).then((res) => res.json());
    }, queryParamsMap);

    return modelsResult;
  }

  // https://suchen.mobile.de/fahrzeuge/details.html?id=219709942
  @Get("/api/cars/:id")
  async getCarById(@Param("id") id: string, @Query() query) {
    let {
      userId
    }: any = query;
    const browserPage = await this.preparePage("getCarById", userId);

    await goto(browserPage, `https://m.mobile.de/fahrzeuge/details.html?id=${id}`);

    await browserPage.waitForSelector("[data-testid=\"vip-key-features-box\"]");

    const { $ } = await getCheerio(browserPage);

    const listItems = $("[data-testid^=\"vip-key-features-list-item-\"]").get();

    const features = listItems.map(el => {
      const testId = $(el).attr("data-testid");
      const key = testId.replace("vip-key-features-list-item-", "");
      const [_, labelEl, valueEl] = $(el).find("div").get();

      return {
        key,
        label: $(labelEl).text(),
        value: $(valueEl).text()
      };
    });

    const technicalDataEl = $("[data-testid=\"vip-technical-data-box\"] dl > dt").get();

    const technicalData = technicalDataEl.map(el => {
      const testId = el.attribs["data-testid"];
      let key;
      let label;
      let value;
      if (testId) {
        key = testId.split("-item")[0];
        label = $(el).text();
        value = $(`[data-testid="${testId}"] + dd`).text();
      }

      return {
        key,
        label,
        value
      };
    });

    const similarElements = $("[data-testid^=\"vip-similar-ads-\"]").get();
    similarElements.map(el => {
      const name = $(el).find("h2").text();
      const price = $(el).find("[data-testid=\"price-label\"]").text();
      const imgUrl = $(el).find("[data-testid=\"header-preview-image\"]").attr("src");

      return {
        name,
        price,
        imgUrl
      };
    });

    return {
      features,
      technicalData,
      similarElements
    };
  }

  @Get("/api/cars")
  async getCars(@Query() query) {
    let {
      yearFrom,
      yearTo,
      priceFrom,
      priceTo,
      mileageFrom,
      mileageTo,
      page,
      model,
      brand,
      sort,
      order, // asc / desc
      userId,
      pwFrom,
      pwTo
    }: any = query;

    const browserPage = await this.preparePage("cars", userId);

    // const optionElements = await this.getBrands();
    //
    // const selectedBrand = optionElements.find((r) => r.label === brand);
    //
    // if (!selectedBrand) {
    //   return {
    //     error: {
    //       message: 'Выберите бренд авто',
    //       details: optionElements.map((r) => ({
    //         ...r,
    //         url: `http://localhost:3001/?${[...Object.entries(query), ['brand', r.label]].map(([k, v]) => `${k}=${v}`).join('&')}`,
    //       })),
    //     },
    //   };
    // }
    //
    // const modelsResult = await this._page.evaluate((selectedBrand) => {
    //   return fetch(
    //     `https://m.mobile.de/consumer/api/search/reference-data/models/${selectedBrand.value}`,
    //   ).then((res) => res.json());
    // }, selectedBrand);
    //
    // const modelsNameValueMap = new Map(
    //   modelsResult.data.filter((r) => !!r.value).map((i) => [i.label, i.value]),
    // );
    // const selectedModel = modelsNameValueMap.get(model);
    // if (!selectedModel) {
    //   return {
    //     error: {
    //       message: 'Выберите модель авто',
    //       details: modelsResult.data.map((r) => {
    //         const queryWithoutModel = Object.entries(query).filter(
    //           ([key]) => key !== 'model',
    //         );
    //
    //         if (!r.items) {
    //           return {
    //             ...r,
    //             url: `http://localhost:3001/?${[...queryWithoutModel, ['model', r.label]].map(([k, v]) => `${k}=${v}`).join('&')}`,
    //           };
    //         } else {
    //           return {
    //             ...r,
    //             items: r.items.map((rr) => ({
    //               ...rr,
    //               url: `http://localhost:3001/?${[...queryWithoutModel, ['model', rr.label]].map(([k, v]) => `${k}=${v}`).join('&')}`,
    //             })),
    //           };
    //         }
    //       }),
    //     },
    //   };
    // }

    if (priceFrom) priceFrom = parseInt(priceFrom) / EUR_RUB;
    if (priceTo) priceTo = parseInt(priceTo) / EUR_RUB;
    // Мощность
    if (pwFrom) pwFrom = Math.floor(parseInt(pwFrom) / 1.36);
    if (pwTo) pwTo = Math.floor(parseInt(pwTo) / 1.36);

    if (brand === "null") {
      brand = "";
    }

    if (model === "null") {
      model = "";
    }

    const queryParamsMap = {
      dam: "false",
      ref: "quickSearch",
      s: "Car",
      // По какому полю сортировать
      sb: sort || "rel",
      // Сортировка в какую сторону - up / down
      od: order ? (order === "asc" ? "up" : "down") : "",
      vc: "Car",
      p: fromTo(priceFrom, priceTo), // `%253A${priceTo}`,
      ms: encodeURIComponent(`${brand};${model};;`),
      ml: fromTo(mileageFrom, mileageTo), // `%253A${mileageTo}`,
      isSearchRequest: "true",
      pageNumber: page,
      fr: fromTo(yearFrom, yearTo), // 2018%3A2020
      pw: fromTo(pwFrom, pwTo)
    };

    let url = "https://suchen.mobile.de/fahrzeuge/search.html";

    const searchString = Object.entries(queryParamsMap)
      .filter(([key, value]) => !!value)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    if (searchString) url += `?${searchString}`;

    const URL = decodeURI(url);

    await goto(browserPage, URL);

    await browserPage.waitForSelector("[data-testid=\"result-list-container\"]");

    return extractTextContent(browserPage).then((r) => ({ ...r, URL, page: parseInt(page || 1) }));
  }
}
