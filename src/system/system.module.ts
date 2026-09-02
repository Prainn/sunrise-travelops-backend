import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictionaryItemEntity } from './dictionaries/dictionary-item.entity';
import { DictionaryTypeEntity } from './dictionaries/dictionary-type.entity';
import { SystemDictionariesController } from './dictionaries/system-dictionaries.controller';
import { SystemDictionariesService } from './dictionaries/system-dictionaries.service';
import { BusinessDictionaryItemEntity } from './business-dictionaries/business-dictionary-item.entity';
import { BusinessDictionaryTypeEntity } from './business-dictionaries/business-dictionary-type.entity';
import { SystemBusinessDictionariesController } from './business-dictionaries/system-business-dictionaries.controller';
import { SystemBusinessDictionariesService } from './business-dictionaries/system-business-dictionaries.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DictionaryTypeEntity,
      DictionaryItemEntity,
      BusinessDictionaryTypeEntity,
      BusinessDictionaryItemEntity,
    ]),
  ],
  controllers: [
    SystemDictionariesController,
    SystemBusinessDictionariesController,
  ],
  providers: [SystemDictionariesService, SystemBusinessDictionariesService],
  exports: [SystemDictionariesService, SystemBusinessDictionariesService],
})
export class SystemModule {}
