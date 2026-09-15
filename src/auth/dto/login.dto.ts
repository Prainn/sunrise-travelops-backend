import { LOGIN_SCOPES, LoginScope } from '../../users/user-identity.entity';
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Length, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ enum: LOGIN_SCOPES })
  @IsIn(LOGIN_SCOPES)
  scope: LoginScope;

  @ApiProperty({ example: 'admin' })
  @IsString()
  @Length(3, 80)
  username: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(6)
  password: string;
}
