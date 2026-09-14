import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ format: 'password', minLength: 6, maxLength: 128 })
  @IsString()
  @Length(6, 128)
  oldPassword: string;

  @ApiProperty({ format: 'password', minLength: 6, maxLength: 128 })
  @IsString()
  @Length(6, 128)
  newPassword: string;
}
