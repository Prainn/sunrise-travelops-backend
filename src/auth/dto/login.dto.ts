import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin' })
  @IsString()
  @Length(3, 80)
  username: string;

  @ApiProperty({ format: 'password' })
  @IsString()
  @MinLength(6)
  password: string;
}
