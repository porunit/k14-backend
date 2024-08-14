import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { AppService } from './app.service';
import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from "axios";

async function createBrowser() {
  return puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
}

async function createPage(browser: Browser) {
  const page = await browser.newPage();
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  );

  return page;
}

async function extractTextContent(page) {
  const htmlContent = await page.content();
  const $ = cheerio.load(htmlContent);

  const LIST_ITEMS_SELECTOR =
    '[data-testid="result-list-container"] a[data-testid^="result-listing-"]';
  // const PAGINATION_BUTTONS_SELECTOR ="[data-testid=\"srp-pagination\"] button:not([data-testid=\"pagination:next\"])";
  const TOTAL_COUNT_SELECTOR = '[data-testid="srp-title"]';

  const ITEMS_PER_PAGE = 20;

  const lastButtonText = $(TOTAL_COUNT_SELECTOR).text();
  // const lastButton = $(PAGINATION_BUTTONS_SELECTOR).last();
  // const lastButtonText = lastButton.text();

  // console.log(lastButton);
  // console.log(lastButtonText);
  const totalCount = parseInt(lastButtonText.split(' ')[0].replace('.', ''));
  // const lastPageNumber = parseInt(lastButtonText);
  // const totalCount = ITEMS_PER_PAGE * lastPageNumber;
  const listItemsElements = $(LIST_ITEMS_SELECTOR);

  const listItems = listItemsElements
    .map((index, element) => {
      const url = $(element).attr('href');
      const detailsElement = $(element).find(
        '[data-testid="listing-details-attributes"]',
      );
      const detailsText = detailsElement.text();

      const [date, mileage, ...attrs] = detailsText.split(' • ');

      const titleElement = $(element).find('h2');
      const titleText = titleElement.text();

      const priceElement = $(element).find('[data-testid="price-label"]');
      const priceText = priceElement.text();

      const imgElements = $(element).find(
        '[data-testid^="result-listing-image-"]',
      );
      const imgUrls = imgElements
        .map((i, imgElement) => imgElement.attribs['src'])
        .get();

      return {
        url: `https://suchen.mobile.de${url}`,
        date,
        mileage: parseInt(mileage.split(' ')[0].replace('.', '')),
        title: titleText,
        price: parseInt(priceText.split(' ')[0].replace('.', '')),
        imgUrls,
        detailsText,
      };
    })
    .get();

  return { items: listItems, totalCount };
}

@Controller()
export class AppController {
  private _browser: Browser;
  private _page: Page;

  private _brands;

  constructor(private readonly appService: AppService) {}



  @Get("/")
  async getStatic(@Res() res: Response) {
    const response = await axios.get(
      "https://maksim-zakharov.github.io/mobile-de-frontend/",
      {
        responseType: "stream",
      },
    );
    response.data.pipe(res);
  }

  @Get("/mobile-de-frontend/:path")
  async getAsset(@Param("path") path: string, @Res() res: Response) {
    const response = await axios.get(
      `https://maksim-zakharov.github.io/mobile-de-frontend/${path}`,
      {
        responseType: "stream",
      },
    );
    response.data.pipe(res);
  }

  @Get("/mobile-de-frontend/assets/:path")
  async getCSS(@Param("path") path: string, @Res() res: Response) {
    const response = await axios.get(
      `https://maksim-zakharov.github.io/mobile-de-frontend/assets/${path}`,
      {
        responseType: "stream",
      },
    );
    response.data.pipe(res);
  }

  @Get('colors')
  async getColors() {
    if (!this._browser) {
      this._browser = await createBrowser();
    }

    if (!this._page) {
      this._page = await createPage(this._browser);
    }

    await this._page.goto('https://suchen.mobile.de/fahrzeuge/detailsuche/', {
      waitUntil: 'networkidle2',
    });

    const htmlContent = await this._page.content();
    const $ = cheerio.load(htmlContent);

    return $('[data-testid^="exterior-color-"]')
      .map((i, el) => el.attribs['value'])
      .get();
  }

  @Get('brands')
  async getBrands() {
    if(this._brands){
      return this._brands;
    }

    if (!this._browser) {
      this._browser = await createBrowser();
    }

    if (!this._page) {
      this._page = await createPage(this._browser);
    }

    await this._page.goto('https://www.mobile.de', {
      waitUntil: 'networkidle2',
    });

    const htmlContent = await this._page.content();
    const $ = cheerio.load(htmlContent);

    const OPTION_SELECTOR = '[data-testid="qs-select-make"] option';

    this._brands = $(OPTION_SELECTOR)
      .map((i, el) => ({ value: $(el).attr('value'), label: $(el).text() }))
      .get()
      .filter((r) => !!r.value);
      
    return this._brands;
  }

  @Get('/cars')
  async getHello(@Query() query) {
    const {
      yearFrom,
      yearTo,
      priceFrom,
      priceTo,
      mileageFrom,
      mileageTo,
      page,
      model,
      brand,
    }: {
      page?: string;
      brand?: string;
      yearFrom?: string;
      yearTo?: string;
      priceFrom?: string;
      priceTo?: string;
      mileageFrom?: string;
      mileageTo?: string;
      model?: string;
    } = query;

    // qs-select-make
    // https://www.mobile.de/

    if (!this._browser) {
      this._browser = await createBrowser();
    }

    if (!this._page) {
      this._page = await createPage(this._browser);
    }

    const fromTo = (from: string, to: string) =>
      from && to
        ? `${from}%3A${yearTo}`
        : from
          ? `${from}%253A`
          : to
            ? `%253A${to}`
            : '';

    const optionElements = await this.getBrands();

    const selectedBrand = optionElements.find((r) => r.label === brand);

    if (!selectedBrand) {
      return {
        error: {
          message: 'Выберите бренд авто',
          details: optionElements.map((r) => ({
            ...r,
            url: `http://localhost:3001/?${[...Object.entries(query), ['brand', r.label]].map(([k, v]) => `${k}=${v}`).join('&')}`,
          })),
        },
      };
    }

    const modelsResult = await this._page.evaluate((selectedBrand) => {
      return fetch(
        `https://m.mobile.de/consumer/api/search/reference-data/models/${selectedBrand.value}`,
      ).then((res) => res.json());
    }, selectedBrand);

    const modelsNameValueMap = new Map(
      modelsResult.data.filter((r) => !!r.value).map((i) => [i.label, i.value]),
    );
    const selectedModel = modelsNameValueMap.get(model);
    if (!selectedModel) {
      return {
        error: {
          message: 'Выберите модель авто',
          details: modelsResult.data.map((r) => {
            const queryWithoutModel = Object.entries(query).filter(
              ([key]) => key !== 'model',
            );

            if (!r.items) {
              return {
                ...r,
                url: `http://localhost:3001/?${[...queryWithoutModel, ['model', r.label]].map(([k, v]) => `${k}=${v}`).join('&')}`,
              };
            } else {
              return {
                ...r,
                items: r.items.map((rr) => ({
                  ...rr,
                  url: `http://localhost:3001/?${[...queryWithoutModel, ['model', rr.label]].map(([k, v]) => `${k}=${v}`).join('&')}`,
                })),
              };
            }
          }),
        },
      };
    }

    const queryParamsMap = {
      dam: 'false',
      ref: 'quickSearch',
      s: 'Car',
      sb: 'rel',
      vc: 'Car',
      p: fromTo(priceFrom, priceTo), // `%253A${priceTo}`,
      ms: `${selectedBrand.value}%253B${selectedModel}%253B%253B`,
      ml: fromTo(mileageFrom, mileageTo), // `%253A${mileageTo}`,
      isSearchRequest: 'true',
      pageNumber: page,
      fr: fromTo(yearFrom, yearTo), // 2018%3A2020
    };

    let url = 'https://suchen.mobile.de/fahrzeuge/search.html';

    const searchString = Object.entries(queryParamsMap)
      .filter(([key, value]) => !!value)
      .map(([key, value]) => `${key}=${value}`)
      .join('&');

    if (searchString) url += `?${searchString}`;

    const URL = decodeURI(url);

    await this._page.goto(URL, { waitUntil: 'networkidle2' });

    await this._page.waitForSelector('[data-testid="result-list-container"]');

    return extractTextContent(this._page).then((r) => ({ ...r, URL }));
  }
}
