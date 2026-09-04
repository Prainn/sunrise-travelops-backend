import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiResponse {
  @ApiProperty({ example: 'SUCCESS' })
  code: 'SUCCESS';

  @ApiProperty({ example: 'success' })
  message: string;

  @ApiProperty({ type: Object, nullable: true })
  data: unknown;
}

export class ApiErrorResponse {
  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code: string;

  @ApiProperty({ example: '请求参数校验失败' })
  message: string;

  @ApiProperty({ type: 'null', example: null })
  data: null;

  @ApiProperty({ type: Object, example: {} })
  details: Record<string, unknown>;

  @ApiProperty({ format: 'date-time' })
  timestamp: string;

  @ApiProperty({ example: '/api/users' })
  path: string;

  @ApiPropertyOptional({ example: '5b27da65-73b8-4d6c-9037-39467bd6d34f' })
  requestId?: string;
}

export class PageResult {
  @ApiProperty({ type: [Object] })
  list: unknown[];

  @ApiProperty({ example: 156 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  pageSize: number;
}
