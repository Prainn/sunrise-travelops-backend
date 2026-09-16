import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LynxVisit } from './lynx-visit.entity';
import { LynxController } from './lynx.controller';
import { WhatsappRegistryService } from './whatsapp-registry.service';

@Module({
  imports: [TypeOrmModule.forFeature([LynxVisit])],
  controllers: [LynxController],
  providers: [WhatsappRegistryService],
})
export class LynxModule {}
