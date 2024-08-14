import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Telegraf } from "telegraf";

const webAppUrl = "https://maksim-zakharov.github.io/mobile-de-frontend";

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController],
  providers: [AppService,
    {
      provide: "Telegraf",
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const bot = new Telegraf(configService.get<string>("TELEGRAM_TOKEN"), {
          handlerTimeout: Infinity
        });

        bot.on("message", async function(ctx: any, next) {

          const prompt = ctx.update.message.text;

          if (prompt === "/start") {
            ctx.reply("Ниже появится кнопка, заполните форму", {
              reply_markup: {
                keyboard: [
                  [{ text: "Сделать заказ", web_app: { url: webAppUrl } }]
                ]
              }
            });
          }
        });

        // await bot.telegram
        //   // .setMyCommands([
        //   //   {
        //   //     command: "/create_image",
        //   //     description: "Создать картинку"
        //   //   }
        //   // ])
        //   .then(() => console.log("Команды установлены"))
        //   .catch((e) =>
        //     console.log(
        //       "Не удалось установить команды для телеграмм",
        //       e.message
        //     )
        //   );

        bot
          .launch()
          .catch((e) =>
            console.log(`Не удалось запустить телеграмм-бота`, e.message)
          );
      }
    }
  ]
})
export class AppModule {
}
