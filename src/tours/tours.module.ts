import { Module } from '@nestjs/common';
import { GuideLeavesService } from './guide-leaves.service';
import { GuideLeavesController, ToursController } from './tours.controller';
import { ToursService } from './tours.service';

@Module({
  controllers: [ToursController, GuideLeavesController],
  providers: [ToursService, GuideLeavesService],
})
export class ToursModule {}
