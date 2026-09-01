import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with username and password' })
  login(@Body() input: LoginDto) {
    return this.auth.login(input.username, input.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate access and refresh tokens' })
  refresh(@Body() input: RefreshTokenDto) {
    return this.auth.refresh(input.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.id);
  }

  @Get('me')
  @ApiBearerAuth()
  getCurrentUser(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
