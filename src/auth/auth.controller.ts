import {
  LinkedAccountResponse,
  SwitchAccountDto,
} from '../users/dto/account-link.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { Request } from 'express';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
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
  @Throttle({ default: { limit: 150, ttl: 60_000 } })
  @ApiOperation({ summary: 'Log in with username and password' })
  @ApiSuccessResponse({ type: AuthTokensResponse })
  login(@Body() input: LoginDto, @Req() request: Request) {
    return this.auth.login(
      input.username,
      input.password,
      {
        ip: request.ip ?? '',
        userAgent: request.get('user-agent') ?? '',
      },
      input.scope,
    );
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
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
    return this.auth.logout(user);
  }

  @Patch('me/profile')
  @HttpCode(204)
  // Self-service only: the service always targets the authenticated actor.
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update own nickname, avatar and gender' })
  @ApiNoContentResponse()
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user, input);
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
    return this.auth.getProfile(user);
  }

  @Get('me/security')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Get own enabled roles, effective permissions and recent successful logins',
  })
  @ApiSuccessResponse({ type: ProfileSecurityResponse })
  getProfileSecurity(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.getProfileSecurity(user);
  }

  @Get('linked-accounts')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List current and available linked business accounts',
  })
  @ApiSuccessResponse({ type: LinkedAccountResponse, isArray: true })
  linkedAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.linkedAccounts(user);
  }

  @Post('switch-account')
  @HttpCode(200)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Switch this session to a linked account without a password',
  })
  @ApiSuccessResponse({ type: AuthTokensResponse })
  switchAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() input: SwitchAccountDto,
    @Req() req: Request,
  ) {
    return this.auth.switchAccount(user, input.targetUserId, req.ip ?? '');
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiSuccessResponse({ type: AuthenticatedUserResponse })
  getCurrentUser(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
