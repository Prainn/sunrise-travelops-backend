import { ChangePasswordDto } from './dto/change-password.dto';
import type { Request } from 'express';
import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  ApiCommonErrorResponses,
  ApiSuccessResponse,
} from '../common/swagger/api-response.decorator';
import { AuthService } from './auth.service';
import { AuthenticatedUser } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  UserProfileResponse,
  ProfileSecurityResponse,
  AuthenticatedUserResponse,
  AuthTokensResponse,
} from './dto/auth-response.dto';

@ApiTags('Auth')
@ApiCommonErrorResponses()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with username and password' })
  @ApiSuccessResponse({ type: AuthTokensResponse })
  login(@Body() input: LoginDto, @Req() request: Request) {
    return this.auth.login(input.username, input.password, {
      ip: request.ip ?? '',
      userAgent: request.get('user-agent') ?? '',
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate access and refresh tokens' })
  @ApiSuccessResponse({ type: AuthTokensResponse })
  refresh(@Body() input: RefreshTokenDto) {
    return this.auth.refresh(input.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse()
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.id);
  }

  @Post('me/password')
  @HttpCode(204)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Change own password after verifying the current password',
  })
  @ApiNoContentResponse()
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: ChangePasswordDto,
  ) {
    return this.auth.changePassword(
      user.id,
      input.oldPassword,
      input.newPassword,
    );
  }

  @Get('me/profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get own personal profile' })
  @ApiSuccessResponse({ type: UserProfileResponse })
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfile(user.id);
  }

  @Get('me/security')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get own enabled roles, effective permissions and recent successful logins',
  })
  @ApiSuccessResponse({ type: ProfileSecurityResponse })
  getProfileSecurity(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfileSecurity(user.id);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiSuccessResponse({ type: AuthenticatedUserResponse })
  getCurrentUser(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
