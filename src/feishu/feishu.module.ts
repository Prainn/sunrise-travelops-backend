import { Module } from '@nestjs/common';
import { FeishuService } from './feishu.service';

@Module({ providers: [FeishuService], exports: [FeishuService] })
export class FeishuModule {}
