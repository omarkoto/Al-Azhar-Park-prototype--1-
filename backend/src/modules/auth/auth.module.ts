import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LoggingPasswordLinkNotifier, PasswordLinkNotifier } from './password-link-notifier';
import { TokenService } from './token.service';

/** Authentication and authorization. The global guards are registered in AppModule, in a fixed order. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    { provide: PasswordLinkNotifier, useClass: LoggingPasswordLinkNotifier },
  ],
  exports: [AuthService, TokenService, PasswordLinkNotifier],
})
export class AuthModule {}
