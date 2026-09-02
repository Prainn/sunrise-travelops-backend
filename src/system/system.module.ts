import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictionaryItemEntity } from './dictionaries/dictionary-item.entity';
import { DictionaryTypeEntity } from './dictionaries/dictionary-type.entity';
import { SystemDictionariesController } from './dictionaries/system-dictionaries.controller';
import { SystemDictionariesService } from './dictionaries/system-dictionaries.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DictionaryTypeEntity, DictionaryItemEntity]),
  ],
  controllers: [SystemDictionariesController],
  providers: [SystemDictionariesService],
  exports: [SystemDictionariesService],
})
export class SystemModule {}
