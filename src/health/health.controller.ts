import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../auth/decorators/public.decorator';
import { SkipResponseWrap } from '../common/decorators/skip-response-wrap.decorator';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: TypeOrmHealthIndicator,
  ) {}

  @Get()
  @Public()
  @SkipResponseWrap()
  @HealthCheck()
  @ApiOperation({ summary: 'Check API and PostgreSQL health' })
  check() {
    return this.health.check([
      () => Promise.resolve({ api: { status: 'up' as const } }),
      () => this.database.pingCheck('postgres'),
    ]);
  }
}
