import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LynxVisit } from './lynx-visit.entity';
import { LynxController } from './lynx.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LynxVisit])],
  controllers: [LynxController],
})
export class LynxModule {}
