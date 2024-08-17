import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';

@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController],
  providers: [
    AppService,
    // {
    //   provide: 'Telegraf',
    //   inject: [ConfigService, AppService],
    //   useFactory: async (configService: ConfigService, appService: AppService) => {
    //     const bot = new Telegraf(configService.get<string>('TELEGRAM_TOKEN'), {
    //       handlerTimeout: Infinity,
    //     });
    //
    //     bot.on('message', async function (ctx: any, next) {
    //       const prompt = ctx.update.message.text;
    //
    //       if (prompt === '/start') {
    //         ctx.reply(`Нажмите на кнопку Open App. Сейчас пользуются: ${Object.keys(appService._pageMap).length - 2}`);
    //
    //         bot
    //           .launch()
    //           .catch((e) =>
    //             console.log(`Не удалось запустить телеграмм-бота`, e.message),
    //           );
    //       }
    //     });
    //   },
    // },
  ],
})
export class AppModule {}
