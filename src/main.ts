import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const PORT = process.env.PORT || 3001

  await app.listen(PORT, () => console.log(`Server started on http://localhost:${PORT}`));
}
bootstrap();
