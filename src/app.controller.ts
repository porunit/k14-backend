import {
  Controller,
  Get,
  OnModuleInit,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { AppService } from './app.service';
import puppeteer, { Browser, Page } from 'puppeteer';
import * as cheerio from 'cheerio';
import axios from 'axios';

const ORIGIN = 'https://maksim-zakharov.github.io';
const FRONTEND_NAME = 'mobile-de-frontend';

const headers = {};
headers['x-mobile-client'] =
  'de.mobile.iphone.app/11.5.1/50DBC5FB-5255-4144-BEB7-42F7DE7DCD65';
headers['user-agent'] = 'mobile.de_iPhone_de/11.5.1';
headers['x-mobile-device-type'] = 'phone';

async function createBrowser() {
  return puppeteer.launch({
    headless: true,
    args: [
      // "--enable-features=NetworkService",
      '--no-sandbox',
      // "--disable-setuid-sandbox",
      // "--disable-dev-shm-usage",
      // "--disable-accelerated-2d-canvas",
      // "--disable-gpu",
      // "--window-size=1920x1080"
    ],
  });
}

async function createPage(browser: Browser) {
  const page = await browser.newPage();

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  );

  await page.setViewport({
    width: 1920,
    height: 1080,
  });

  const withoutAssets = false;

  if (withoutAssets) {
    const blockedResourceTypes = [
      'image',
      'media',
      'font',
      'texttrack',
      'object',
      'beacon',
      'csp_report',
      'imageset',
    ];

    const skippedResources = [
      'quantserve',
      'adzerk',
      'doubleclick',
      'adition',
      'exelator',
      'sharethrough',
      'cdn.api.twitter',
      'google-analytics',
      'googletagmanager',
      // 'google', // Нужно для рекапчи гугла, без этого не работает кнопка логина
      'fontawesome',
      'facebook',
      'analytics',
      'optimizely',
      'clicktale',
      'mixpanel',
      'zedo',
      'clicksor',
      'mc.yandex.ru',
      '.mail.ru',
      'tiqcdn',
      'https://www.upwork.com/upi/psmetrics',
      '.px-cloud.net',
      'https://bcdn-logs.upwork.com',
      'https://p.tvpixel.com',
      'www.googletagmanager.com',
      'www.redditstatic.com',
    ];
    try {
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const requestUrl = request.url().split('?')[0].split('#')[0];
        if (
          blockedResourceTypes.indexOf(request.resourceType()) !== -1 ||
          skippedResources.some(
            (resource) => requestUrl.indexOf(resource) !== -1,
          ) ||
          // Be careful with above
          request.url().includes('.jpg') ||
          request.url().includes('.jpeg') ||
          request.url().includes('.png') ||
          request.url().includes('.gif') ||
          request.url().includes('.css')
        )
          request.abort();
        else request.continue();
      });
    } catch (e) {}
  }
  return page;
}

const fromTo = (from: string, to: string) => {
  if (from === 'null') {
    from = '';
  }

  if (to === 'null') {
    to = '';
  }

  return from && to
    ? `${from}:${to}` // encodeURIComponent(`${from}:${to}`)
    : from
      ? `${from}:` // encodeURIComponent(`${from}:`)
      : to
        ? `:${to}` // encodeURIComponent(`:${to}`)
        : '';
};

const getCheerio = async (page: Page) => {
  const content = await page.content();
  const $ = cheerio.load(content);
  return { content, $ };
};

const goto = (page: Page, url: string) =>
  page.goto(url, { waitUntil: 'networkidle2' });

async function extractTextContent(page, EUR_RUB) {
  const { $ } = await getCheerio(page);

  const LIST_ITEMS_SELECTOR =
    '[data-testid="result-list-container"] a[data-testid^="result-listing-"]';
  const TOTAL_COUNT_SELECTOR = '[data-testid="srp-title"]';

  const lastButtonText = $(TOTAL_COUNT_SELECTOR).text();
  const totalCount = parseInt(lastButtonText.split(' ')[0].replace('.', ''));
  const listItemsElements = $(LIST_ITEMS_SELECTOR);

  const items = listItemsElements
    .map((index, element) => {
      const url = $(element).attr('href');
      const searchParams = new URLSearchParams(url.split('?')[1]);
      const id = searchParams.get('id');

      const isSponsored = Boolean(
        $(element).find('[data-testid="sponsored-badge"]').get()[0],
      );

      const detailsElement = $(element).find(
        '[data-testid="listing-details-attributes"]',
      );
      const detailsText = detailsElement.text();

      const detailsRows = detailsText.split(' • ');

      const date = detailsRows[0];
      const mileage = detailsRows[1];
      const powerText = detailsRows[2];

      const filterWords = 'Unfallfrei • ';
      let diff = 0;
      if (detailsText.includes(filterWords)) {
        diff = 1;
      }

      const fuelTypeRu = {
        Benzin: 'Бензин',
        'Hybrid (Benzin/Elektro)': 'Гибрид', // 'Гибрид (Бензин/Электро)',
        'Hybrid (Diesel/Elektro)': 'Гибрид', // 'Гибрид (Дизель/Электро)',
        Diesel: 'Дизель',
      };

      const transmissionTypeRu = {
        Automatik: 'Автомат',
        Halbautomatik: 'Полуавтомат',
        Schaltgetriebe: 'Ручная',
      };

      const fuelType =
        fuelTypeRu[detailsRows[3 + diff]] || detailsRows[3 + diff];
      const transmissionType =
        transmissionTypeRu[detailsRows[4 + diff]] || detailsRows[4 + diff];
      let conditionType = detailsRows[5 + diff]?.split('HU ')[1];
      if (conditionType === 'Neu') {
        conditionType = 'Новый';
      }

      const power = parseInt(
        detailsText.match(/(\d+) PS/gm)?.[0]?.split(' PS')?.[0] || '0',
      );

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

      const valutePrice = parseInt(priceText.split(' ')[0].replace('.', ''));

      return {
        id,
        url: `https://suchen.mobile.de${url}`,
        date,
        power,
        mileage: parseInt(mileage.split(' ')[0].replace('.', '')),
        title: titleText,
        price: Math.floor(valutePrice * EUR_RUB),
        priceWithoutVAT: Math.floor((valutePrice / 1.19) * EUR_RUB),
        imgUrls,
        isSponsored,
        detailsText,
        fuelType,
        transmissionType,
        conditionType,
      };
    })
    .get()
    .filter((i) => !i.isSponsored)
    .map(({ isSponsored, ...i }) => i);

  return { items, totalCount };
}

const HOST = process.env.HOST || `${ORIGIN}/${FRONTEND_NAME}`;

const tempRu = [
  { label: 'ABS', value: 'ABS', ru: 'Антиблокировочная система (ABS)' },
  {
    label: 'Abstandswarner',
    value: 'DISTANCE_WARNING_SYSTEM',
    ru: 'Система экстренного торможения',
  },
  {
    label: 'Adaptives Kurvenlicht',
    value: 'ADAPTIVE_BENDING_LIGHTS',
    ru: 'Адаптивный свет',
  },
  { label: 'Allradantrieb', value: 'FOUR_WHEEL_DRIVE', ru: 'Полный привод' },
  {
    label: 'Allwetterreifen',
    value: 'ALL_SEASON_TIRES',
    ru: 'Всесезонные шины',
  },
  {
    label: 'Beheizbare Frontscheibe',
    value: 'HEATED_WINDSHIELD',
    ru: 'Обогрев лобового стекла',
  },
  {
    label: 'Berganfahrassistent',
    value: 'HILL_START_ASSIST',
    ru: 'Система помощи при трогании на подъеме',
  },
  {
    label: 'Bi-Xenon Scheinwerfer',
    value: 'BI_XENON_HEADLIGHTS',
    ru: 'Биксеноновые фары',
  },
  {
    label: 'Blendfreies Fernlicht',
    value: 'GLARE_FREE_HIGH_BEAM',
    ru: 'Антибликовый свет',
  },
  { label: 'Dachreling', value: 'ROOF_RAILS', ru: 'Рейлинги на крыше' },
  {
    label: 'Elektr. Heckklappe',
    value: 'ELECTRIC_TAILGATE',
    ru: 'Электропривод двери багажника',
  },
  { label: 'Elektr. Wegfahrsperre', value: 'IMMOBILIZER', ru: 'Иммобилайзер' },
  {
    label: 'ESP',
    value: 'ESP',
    ru: 'Система стабилизации (ESP)',
  },
  {
    label: 'Fernlichtassistent',
    value: 'HIGH_BEAM_ASSIST',
    ru: 'Ассистент дальнего света',
  },
  {
    label: 'Geschwindigkeits- begrenzungsanlage',
    value: 'SPEED_LIMITER',
    ru: 'Система ограничения скорости',
  },
  { label: 'Kurvenlicht', value: 'BENDING_LIGHTS', ru: 'Поворотный свет' },
  {
    label: 'Laserlicht',
    value: 'LASER_HEADLIGHTS',
    ru: 'Лазерные фары',
  },
  {
    label: 'LED-Scheinwerfer',
    value: 'LED_HEADLIGHTS',
    ru: 'Светодиодные фары',
  },
  {
    label: 'LED-Tagfahrlicht',
    value: 'LED_RUNNING_LIGHTS',
    ru: 'Светодиодные дневные ходовые огни',
  },
  { label: 'Leichtmetallfelgen', value: 'ALLOY_WHEELS', ru: 'Литые диски' },
  {
    label: 'Lichtsensor',
    value: 'LIGHT_SENSOR',
    ru: 'Датчик освещенности',
  },
  {
    label: 'Luftfederung',
    value: 'AIR_SUSPENSION',
    ru: 'Пневматическая подвеска',
  },
  {
    label: 'Nachtsichtassistent',
    value: 'NIGHT_VISION_ASSIST',
    ru: 'Ассистент ночного видения',
  },
  {
    label: 'Nebelscheinwerfer',
    value: 'FRONT_FOG_LIGHTS',
    ru: 'Противотуманные фары',
  },
  {
    label: 'Notbremsassistent',
    value: 'COLLISION_AVOIDANCE',
    ru: 'Ассистент экстренного торможения',
  },
  { label: 'Notrad', value: 'EMERGENCY_WHEEL', ru: 'Запасное колесо' },
  {
    label: 'Pannenkit',
    value: 'REPAIR_KIT',
    ru: 'Разборный комплект',
  },
  {
    label: 'Panoramadach',
    value: 'PANORAMIC_GLASS_ROOF',
    ru: 'Панорамная крыша',
  },
  {
    label: 'Regensensor',
    value: 'AUTOMATIC_RAIN_SENSOR',
    ru: 'Датчик дождя',
  },
  {
    label: 'Reifendruckkontrolle',
    value: 'TIRE_PRESSURE_MONITORING',
    ru: 'Контроль давления в шинах',
  },
  { label: 'Reserverad', value: 'SPARE_WHEEL', ru: 'Запасное колесо' },
  {
    label: 'Scheinwerferreinigung',
    value: 'HEADLIGHT_WASHER_SYSTEM',
    ru: 'Очистка фар',
  },
  {
    label: 'Schiebedach',
    value: 'SUNROOF',
    ru: 'Люк на крыше',
  },
  {
    label: 'Schlüssellose Zentralverriegelung (Keyless)',
    value: 'KEYLESS_ENTRY',
    ru: 'Центральный замок без ключа (Keyless)',
  },
  {
    label: 'Servolenkung',
    value: 'POWER_ASSISTED_STEERING',
    ru: 'Усилитель руля',
  },
  {
    label: 'Sommerreifen',
    value: 'SUMMER_TIRES',
    ru: 'Летние шины',
  },
  {
    label: 'Sportfahrwerk',
    value: 'PERFORMANCE_HANDLING_SYSTEM',
    ru: 'Спортивная подвеска',
  },
  { label: 'Sportpaket', value: 'SPORT_PACKAGE', ru: 'Спортивный пакет' },
  {
    label: 'Spurhalteassistent',
    value: 'LANE_DEPARTURE_WARNING',
    ru: 'Помощник по поддержанию полосы движения',
  },
  { label: 'Stahlfelgen', value: 'STEEL_WHEELS', ru: 'Стальные диски' },
  {
    label: 'Start/Stopp-Automatik',
    value: 'START_STOP_SYSTEM',
    ru: 'Автоматический старт/стоп',
  },
  {
    label: 'Tagfahrlicht',
    value: 'DAYTIME_RUNNING_LIGHTS',
    ru: 'Дневные ходовые огни',
  },
  {
    label: 'Totwinkelassistent',
    value: 'BLIND_SPOT_MONITOR',
    ru: 'Помощник по слепым зонам',
  },
  {
    label: 'Traktionskontrolle',
    value: 'TRACTION_CONTROL_SYSTEM',
    ru: 'Контроль тяги',
  },
  {
    label: 'Verkehrszeichenerkennung',
    value: 'TRAFFIC_SIGN_RECOGNITION',
    ru: 'Распознавание дорожных знаков',
  },
  {
    label: 'Nichtraucher-Fahrzeug',
    value: 'Nichtraucher-Fahrzeug',
    ru: 'Автомобиль для некурящих',
  },
  {
    label: 'Schlüssellose Zentralverriegelung',
    value: 'Schlüssellose Zentralverriegelung',
    ru: 'Центральный замок без ключа',
  },
  { label: 'Garantie', value: 'Garantie', ru: 'Гарантия' },
  {
    label: 'Anhängerkupplung fest',
    value: 'Anhängerkupplung fest',
    ru: 'Фиксированное прицепное устройство',
  },
  { label: 'Winterreifen', value: 'WINTER_TIRES', ru: 'Зимние шины' },
  {
    label: 'Xenonscheinwerfer',
    value: 'XENON_HEADLIGHTS',
    ru: 'Ксеноновые фары',
  },
  {
    label: 'Zentralverriegelung',
    value: 'CENTRAL_LOCKING',
    ru: 'Центральный замок',
  },
  {
    label: 'Tempomat',
    value: 'CRUISE_CONTROL',
    ru: 'Круиз-контроль',
  },
  {
    label: 'Abstandstempomat',
    value: 'ADAPTIVE_CRUISE_CONTROL',
    ru: 'Дистанционный круиз-контроль',
  },
  { label: 'Alarmanlage', value: 'ALARM_SYSTEM', ru: 'Система сигнализации' },
  {
    label: 'Ambiente-Beleuchtung',
    value: 'AMBIENT_LIGHTING',
    ru: 'Окружающее освещение',
  },
  { label: 'Android Auto', value: 'ANDROID_AUTO', ru: 'Андроид Авто' },
  {
    label: 'Apple CarPlay',
    value: 'CARPLAY',
    ru: 'Apple CarPlay',
  },
  { label: 'Armlehne', value: 'ARM_REST', ru: 'Подлокотник' },
  {
    label: 'Beheizbares Lenkrad',
    value: 'HEATED_STEERING_WHEEL',
    ru: 'Руль с подогревом',
  },
  {
    label: 'Behindertengerecht',
    value: 'DISABLED_ACCESSIBLE',
    ru: 'Доступно для людей с ограниченными возможностями',
  },
  { label: 'Bluetooth', value: 'BLUETOOTH', ru: 'Bluetooth' },
  {
    label: 'Bordcomputer',
    value: 'ON_BOARD_COMPUTER',
    ru: 'Бортовой компьютер',
  },
  { label: 'CD-Spieler', value: 'CD_PLAYER', ru: 'CD-плеер' },
  {
    label: 'Elektr. Fensterheber',
    value: 'ELECTRIC_WINDOWS',
    ru: 'Электрические стеклоподъемники',
  },
  {
    label: 'Elektr. Seitenspiegel',
    value: 'ELECTRIC_EXTERIOR_MIRRORS',
    ru: 'Электрическое боковое зеркало',
  },
  {
    label: 'Elektr. Sitzeinstellung',
    value: 'ELECTRIC_ADJUSTABLE_SEATS',
    ru: 'Электрическая регулировка сиденья',
  },
  {
    label: 'Elektr. Sitzeinstellung, hinten',
    value: 'ELECTRIC_BACKSEAT_ADJUSTMENT',
    ru: 'Электрическая регулировка сиденья сзади',
  },
  {
    label: 'Freisprecheinrichtung',
    value: 'HANDS_FREE_PHONE_SYSTEM',
    ru: 'Громкая связь',
  },
  {
    label: 'Gepäckraumabtrennung',
    value: 'CARGO_BARRIER',
    ru: 'Перегородка багажного отделения',
  },
  {
    label: 'Head-Up Display',
    value: 'HEAD_UP_DISPLAY',
    ru: 'Проекционный дисплей',
  },
  {
    label: 'Induktionsladen für Smartphones',
    value: 'WIRELESS_CHARGING',
    ru: 'Индукционная зарядка для смартфонов',
  },
  {
    label: 'Innenspiegel autom. abblendend',
    value: 'DIMMING_INTERIOR_MIRROR',
    ru: 'Авто салонное зеркало затемнение',
  },
  { label: 'Isofix', value: 'ISOFIX', ru: 'Изофикс' },
  {
    label: 'Isofix Beifahrersitz',
    value: 'PASSENGER_SEAT_ISOFIX_POINT',
    ru: 'Пассажирское сиденье изофикс',
  },
  {
    label: 'Lederlenkrad',
    value: 'LEATHER_STEERING_WHEEL',
    ru: 'Кожаный руль',
  },
  {
    label: 'Lordosenstütze',
    value: 'LUMBAR_SUPPORT',
    ru: 'Поясничная поддержка',
  },
  { label: 'Massagesitze', value: 'MASSAGE_SEATS', ru: 'Массажные сиденья' },
  {
    label: 'Müdigkeitswarner',
    value: 'FATIGUE_WARNING_SYSTEM',
    ru: 'Предупреждение об усталости',
  },
  {
    label: 'Multifunktionslenkrad',
    value: 'MULTIFUNCTIONAL_WHEEL',
    ru: 'Многофункциональное рулевое колесо',
  },
  {
    label: 'Musikstreaming integriert',
    value: 'INTEGRATED_MUSIC_STREAMING',
    ru: 'Интегрированная потоковая передача музыки',
  },
  {
    label: 'Navigationssystem',
    value: 'NAVIGATION_SYSTEM',
    ru: 'Навигационная система',
  },
  {
    label: 'Notrufsystem',
    value: 'EMERGENCY_CALL_SYSTEM',
    ru: 'Система экстренного вызова',
  },
  { label: 'Radio DAB', value: 'DAB_RADIO', ru: 'Радио DAB' },
  {
    label: 'Raucherpaket',
    value: 'SMOKERS_PACKAGE',
    ru: 'Пакет для курящих',
  },
  {
    label: 'Schaltwippen',
    value: 'PADDLE_SHIFTERS',
    ru: 'Подрулевые переключатели',
  },
  {
    label: 'Sitzbelüftung',
    value: 'VENTILATED_SEATS',
    ru: 'Вентиляция сиденья',
  },
  {
    label: 'Sitzheizung',
    value: 'ELECTRIC_HEATED_SEATS',
    ru: 'Подогрев сидений',
  },
  {
    label: 'Sitzheizung hinten',
    value: 'ELECTRIC_HEATED_REAR_SEATS',
    ru: 'Подогрев задних сидений',
  },
  { label: 'Skisack', value: 'SKI_BAG', ru: 'Лыжная сумка' },
  {
    label: 'Soundsystem',
    value: 'SOUND_SYSTEM',
    ru: 'Звуковая система',
  },
  { label: 'Sportsitze', value: 'SPORT_SEATS', ru: 'Спортивные сиденья' },
  {
    label: 'Sprachsteuerung',
    value: 'VOICE_CONTROL',
    ru: 'Голосовое управление',
  },
  {
    label: 'Standheizung',
    value: 'AUXILIARY_HEATING',
    ru: 'Дополнительный отопитель',
  },
  { label: 'Touchscreen', value: 'TOUCHSCREEN', ru: 'Сенсорный экран' },
  {
    label: 'Tuner / Radio',
    value: 'TUNER',
    ru: 'Тюнер/радио',
  },
  { label: 'TV', value: 'TV', ru: 'ТВ' },
  {
    label: 'Umklappbarer Beifahrersitz',
    value: 'FOLD_FLAT_PASSENGER_SEAT',
    ru: 'Складное пассажирское сиденье',
  },
  { label: 'USB', value: 'USB', ru: 'USB' },
  {
    label: 'Volldigitales Kombiinstrument',
    value: 'DIGITAL_COCKPIT',
    ru: 'Полностью цифровая комбинация приборов',
  },
  { label: 'Winterpaket', value: 'WINTER_PACKAGE', ru: 'Зимний пакет' },
  {
    label: 'WLAN / Wifi Hotspot',
    value: 'WIFI_HOTSPOT',
    ru: 'Точка доступа WLAN / Wi-Fi',
  },
];

const tempRuMap = tempRu.reduce(
  (acc, curr) => ({ ...acc, [curr.label]: curr.ru }),
  {},
);
const tempValueMap = tempRu.reduce(
  (acc, curr) => ({ ...acc, [curr.label]: curr.value }),
  {},
);

@Controller()
export class AppController implements OnModuleInit {
  private _browser: Browser;

  private brandModelsMap = {};

  private _brands;

  private EUR_RUB = 100;

  constructor(private readonly appService: AppService) {}

  onModuleInit(): any {
    createBrowser().then((browser) => (this._browser = browser));

    this.getCurrencyRate({ CharCode: 'EUR' }).then(
      (val) => (this.EUR_RUB = val?.Value || 100),
    );
  }

  // https://www.cbr-xml-daily.ru/daily_json.js

  @Get('/api/currency-rate')
  async getCurrencyRate(@Query() { CharCode }: { CharCode: string }) {
    const response = await axios.get(
      `https://www.cbr-xml-daily.ru/daily_json.js`,
    );

    return response.data.Valute[CharCode];
  }

  @Get('/')
  async getStatic(@Res() res) {
    const response = await axios.get(`${HOST}/`, {
      responseType: 'stream',
    });
    // Object.entries(response.headers).map(([key, header]) => res.set(key, header));
    response.data.pipe(res);
  }

  // @Get(`/:path`)
  // async getAsset(@Param("path") path: string, @Res() res) {
  //   const response = await axios.get(`${HOST}/${path}`, {
  //     responseType: "stream"
  //   });
  //   // Object.entries(response.headers).map(([key, header]) => res.set(key, header));
  //   res.set("content-type", response.headers["content-type"]);
  //   response.data.pipe(res);
  // }

  @Get(`/:path`)
  redirect(@Res() res) {
    return res.redirect('/');
  }

  @Get(`/assets/:path`)
  async getCSS(@Param('path') path: string, @Res() res) {
    const response = await axios.get(`${HOST}/assets/${path}`, {
      responseType: 'stream',
    });

    res.set('content-type', response.headers['content-type']);

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

    if (!this.appService._pageMap[key]) {
      this.appService._pageMap[key] = await createPage(this._browser);
    }

    return this.appService._pageMap[key];
  }

  @Get('/api/colors')
  async getColors() {
    const page = await this.preparePage('main');

    await goto(page, 'https://suchen.mobile.de/fahrzeuge/detailsuche/');

    const { $ } = await getCheerio(page);

    return $('[data-testid^="exterior-color-"]')
      .map((i, el) => el.attribs['value'])
      .get();
  }

  @Get('/api/features')
  async getFeatures() {
    return tempRu;
  }

  @Get('/api/brands')
  async getBrands() {
    if (this._brands) {
      return this._brands;
    }

    // const page = await this.preparePage("main");
    //
    // await goto(page, "https://www.mobile.de");
    //
    // const { $ } = await getCheerio(page);
    //
    // const OPTION_SELECTOR = "[data-testid=\"qs-select-make\"] option";
    //
    // this._brands = $(OPTION_SELECTOR)
    //   .map((i, el) => ({ value: $(el).attr("value"), label: $(el).text() }))
    //   .get()
    //   .filter((r) => !!r.value);

    const result = await axios
      .get(`https://www.mobile.de/api/r/makes/Car`, {
        headers,
      })
      .then((res) => res.data);

    this._brands = result.makes
      .map((i) => ({ label: i.n, value: i.i }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return this._brands;
  }

  @Get('/api/models')
  async getModels(@Query() query) {
    const {
      brand,
    }: {
      brand?: string;
    } = query;

    if (!brand) {
      return [];
    }

    if (this.brandModelsMap[brand]) {
      return this.brandModelsMap[brand];
    }

    // const page = await this.preparePage("api");
    //
    // await goto(page, "https://www.mobile.de");

    // const modelsResult = await page.evaluate((selectedBrand) => {
    //   return fetch(
    //     `https://m.mobile.de/consumer/api/search/reference-data/models/${selectedBrand}`
    //   ).then((res) => res.json());
    // }, brand);

    const result = await axios
      .get(`https://www.mobile.de/api/r/models/${brand}`, {
        headers,
      })
      .then((res) => res.data);

    const rus = (val: any) => {
      let label = val.label || '';

      label = label.replace(/(Klasse|Class)/gm, 'Класс');
      label = label.replace(/(Alle|All)/gm, 'Все');
      label = label.replace('Andere', 'Другие');

      return {
        ...val,
        label,
      };
    };

    result.models = result.models.map((i) =>
      rus({ isGroup: Boolean(i.g), label: i.n, value: i.i }),
    );
    // modelsResult.data = modelsResult.data.map(i => i.items ? ({ ...i, items: i.items.map(rus) }) : rus(i));

    if (result?.length > 0) {
      this.brandModelsMap[brand] = result.models;
    }

    return result.models; // .filter((r) => !!r.value);
  }

  @Get('/api/cars/count')
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
      model,
      brand,
      ft,
      c,
      tr,
      fe,
      // Состояние
      con,
    }: any = query;

    if (priceFrom) priceFrom = Math.floor(parseInt(priceFrom) / this.EUR_RUB);
    if (priceTo) priceTo = Math.floor(parseInt(priceTo) / this.EUR_RUB);
    // Мощность
    if (pwFrom) pwFrom = Math.floor(parseInt(pwFrom) / 1.36);
    if (pwTo) pwFrom = Math.floor(parseInt(pwTo) / 1.36);

    let modelGroup = '';
    if (model?.startsWith('group')) {
      modelGroup = model.split('group_')[1];
      model = '';
    }

    const queryParamsMap = {
      dam: 0, // "false",
      ps: 0, // "false",
      psz: 0, // "false",
      // ref: "quickSearch",
      // s: "Car",
      // По какому полю сортировать
      // sb: sort || "rel",
      // Сортировка в какую сторону - up / down
      // od: order ? (order === "asc" ? "up" : "down") : "",
      vc: 'Car',
      pw: fromTo(pwFrom, pwTo),
      p: fromTo(priceFrom, priceTo), // `%253A${priceTo}`,
      ms:
        brand || model || modelGroup ? `${brand};${model};${modelGroup};` : '', // encodeURIComponent(`${brand};${model};${modelGroup};`),
      ml: fromTo(mileageFrom, mileageTo), // `%253A${mileageTo}`,
      // isSearchRequest: "true",
      // pageNumber: page,
      fr: fromTo(yearFrom, yearTo),
      // fuel-type Тип двигателя (массив)
      ft: ft ? (Array.isArray(ft) ? ft : [ft]) : [],
      // Кузов
      c: c ? (Array.isArray(c) ? c : [c]) : [],
      // Комплектация
      fe: fe ? (Array.isArray(fe) ? fe : [fe]) : [],
      // Коробка
      tr: tr ? (Array.isArray(tr) ? tr : [tr]) : [],
      // Состояние
      con,
    };

    // const browserPage = await this.preparePage("api");
    //
    // await goto(browserPage, "https://www.mobile.de");

    // const modelsResult = await browserPage.evaluate((queryParamsMap) => {
    //   const str = Object.entries(queryParamsMap).map(([k, v]) => `${k}=${v}`).join("&");
    //   return fetch(
    //     `https://m.mobile.de/consumer/api/search/hit-count?${str}`
    //   ).then((res) => res.json());
    // }, queryParamsMap);

    // https://www.mobile.de/api/s/?ps=0&psz=0&vc=Car&dam=0

    const searchString = Object.entries(queryParamsMap)
      .filter(([key, value]) => {
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        if (value === 0) {
          return true;
        }
        return !!value;
      })
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return value.map((v) => `${key}=${v}`).join('&');
        }
        return `${key}=${value}`;
      })
      .join('&');

    return axios
      .get(`https://www.mobile.de/api/s/?${searchString}`, {
        headers,
      })
      .then((res) => res.data)
      .then((res) => ({
        ...res,
        count: res.numResultsTotal,
      }));

    // return modelsResult;
  }

  // https://suchen.mobile.de/fahrzeuge/details.html?id=219709942
  @Get('/api/cars/:id')
  async getCarById(@Param('id') id: string) {
    return axios
      .get(`https://www.mobile.de/api/a/${id}`, {
        headers,
      })
      .then((res) => res.data)
      .then((res) => ({
        ...res,
        features: res.features.map((f) => ({
          label: tempRuMap[f] || f,
          value: tempValueMap[f] || f,
        })),
        price: res.price.grs.amount * this.EUR_RUB,
        priceWithoutVAT: (res.price.grs.amount * this.EUR_RUB) / 1.19,
        imgUrls: res.images.map(
          (im) =>
            `https://${im.uri.replace('m.mobile.de/yams-proxy/', '')}?rule=mo-360.jpg`,
        ),
      }));
  }

  @Get('/api/cars')
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
      pwTo,
      ft,
      c,
      tr,
      fe,
      con,
    }: any = query;

    const browserPage = await this.preparePage('cars', userId);

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

    if (priceFrom) priceFrom = Math.floor(parseInt(priceFrom) / this.EUR_RUB);
    if (priceTo) priceTo = Math.floor(parseInt(priceTo) / this.EUR_RUB);
    // Мощность
    if (pwFrom) pwFrom = Math.floor(parseInt(pwFrom) / 1.36);
    if (pwTo) pwTo = Math.floor(parseInt(pwTo) / 1.36);

    if (brand === 'null') {
      brand = '';
    }

    if (model === 'null') {
      model = '';
    }

    let modelGroup = '';
    if (model?.startsWith('group')) {
      modelGroup = model.split('group_')[1];
      model = '';
    }

    // https://www.mobile.de/api/s/?ps=0&top&tic&psz=20&vc=Car&dam=0&con=NEW&ref=dsp&sb=rel&_filters
    const queryParamsMap = {
      dam: 0, // "false",
      ref: 'dsp', // "quickSearch",
      s: 'Car',
      // По какому полю сортировать
      sb: sort || 'rel',
      // Сортировка в какую сторону - up / down
      od: order ? (order === 'asc' ? 'up' : 'down') : '',
      vc: 'Car',
      p: fromTo(priceFrom, priceTo), // `%253A${priceTo}`,
      ms: encodeURIComponent(`${brand};${model};${modelGroup};`),
      ml: fromTo(mileageFrom, mileageTo), // `%253A${mileageTo}`,
      isSearchRequest: 'true',
      ps: (parseInt(page || 1) - 1) * 20, // pageNumber: page,
      psz: 20,
      fr: fromTo(yearFrom, yearTo), // 2018%3A2020
      pw: fromTo(pwFrom, pwTo),
      // fuel-type Тип двигателя (массив)
      ft: ft ? (Array.isArray(ft) ? ft : [ft]) : [],
      // Кузов
      c: c ? (Array.isArray(c) ? c : [c]) : [],
      // Коробка
      tr: tr ? (Array.isArray(tr) ? tr : [tr]) : [],
      // Комплектация
      fe: fe ? (Array.isArray(fe) ? fe : [fe]) : [],
      // Состояние
      con,
    };

    let url = 'https://www.mobile.de/api/s/';

    const searchString = Object.entries(queryParamsMap)
      .filter(([key, value]) => {
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        return !!value;
      })
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return value.map((v) => `${key}=${v}`).join('&');
        }
        return `${key}=${value}`;
      })
      .join('&');

    if (searchString) url += `?${searchString}`;

    const headers = {};
    headers['x-mobile-client'] =
      'de.mobile.iphone.app/11.5.1/50DBC5FB-5255-4144-BEB7-42F7DE7DCD65';
    headers['user-agent'] = 'mobile.de_iPhone_de/11.5.1';
    headers['x-mobile-device-type'] = 'phone';

    const fuelTypeRu = {
      Benzin: 'Бензин',
      'Hybrid (Benzin/Elektro)': 'Гибрид', // 'Гибрид (Бензин/Электро)',
      'Hybrid (Diesel/Elektro)': 'Гибрид', // 'Гибрид (Дизель/Электро)',
      Diesel: 'Дизель',
    };

    const transmissionTypeRu = {
      Automatik: 'Автомат',
      Halbautomatik: 'Полуавтомат',
      Schaltgetriebe: 'Ручная',
    };

    return axios
      .get(url, {
        headers,
      })
      .then((res) => res.data)
      .then((r) => ({
        ...r,
        items: r.items.map((i) => ({
          ...i,
          imgUrls: i.images.map(
            (im) =>
              `https://${im.uri.replace('m.mobile.de/yams-proxy/', '')}?rule=mo-360.jpg`,
          ),
          date: i.attr.fr,
          price: i.price.grs.amount * this.EUR_RUB,
          priceWithoutVAT: (i.price.grs.amount * this.EUR_RUB) / 1.19,
          fuelType: fuelTypeRu[i.attr.ft] || i.attr.ft,
          transmissionType: transmissionTypeRu[i.attr.tr] || i.attr.tr,
          mileage: parseInt(i.attr.ml.replace('.', '')),
          power: parseInt(
            i.attr.pw.match(/(\d+) PS/gm)?.[0]?.split(' PS')?.[0] || '0',
          ),
        })),
      }));
  }
}
