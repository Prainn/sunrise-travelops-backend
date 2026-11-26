import { createHash } from 'node:crypto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsUUID,
  Matches,
  ValidateIf,
} from 'class-validator';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { OperationEntry } from './operation-logs.service';

export const CLIENT_ACTIONS = {
  navigate: '打开页面',
  refresh: '手动刷新',
  retry: '重试本地操作',
  filter: '调整筛选',
  sort: '调整排序',
  paginate: '翻页',
  tab: '切换页签',
  open: '打开面板',
  close: '关闭面板',
  select: '选择项目',
  draft: '修改本地草稿',
  reorder: '调整顺序',
  validate: '校验表单',
  copy: '复制内容',
  language: '切换语言',
  theme: '切换主题',
  print: '调用打印',
  download: '发起本地下载',
  cancel: '取消操作',
  expand: '展开或收起',
  layout: '调整显示设置',
  preview: '本地预览',
} as const;
export const PUBLIC_CLIENT_PAGES = [
  'Login',
  'Unavailable',
  'Forbidden',
  'NotFound',
  'Redirect',
] as const;
export const CLIENT_PAGES = [
  ...PUBLIC_CLIENT_PAGES,
  'App',
  'Dashboard',
  'Profile',
  'WhatsappWorkbench',
  'MailInbox',
  'WhatsappInbox',
  'WhatsappQuickReplies',
  'WhatsappIntegration',
  'System',
  'MenuPermissions',
  'Dict',
  'DictItem',
  'BusinessCategory',
  'User',
  'BusinessGroups',
  'AccountLinks',
  'NotificationManagement',
  'OssManagement',
  'OperationLogs',
  'Inquiries',
  'InquiryList',
  'InquiryItineraries',
  'InquiryLogReport',
  'InquiryLogs',
  'WebsiteInquiries',
  'WebsiteInquiryList',
  'WebsiteInquiryLogReport',
  'WebsiteInquiryLogs',
  'TourismResources',
  'WebsiteResources',
  'Agency',
  'CityResource',
  'Hotel',
  'Restaurant',
  'Attraction',
  'TransportResource',
  'FlightResource',
  'GuideManagement',
  'Guide',
  'GuideLeaves',
  'GuideRatings',
  'DataLedgers',
  'TourList',
  'ShengxuLedger',
  'DirectLedger',
  'WebsiteLedger',
  'ShengxuAgencySummary',
  'ShengxuCoordinatorSummary',
  'LinxiQuoteSummary',
  'LinxiPlatformSummary',
  'WebsiteQuoteSummary',
  'WebsitePlatformSummary',
  'WebsiteVisits',
] as const;
const CLIENT_RESULTS = ['success', 'failure', 'cancelled', 'unknown'] as const;
const CLIENT_VALUES = [
  'zh-cn',
  'en',
  'light',
  'dark',
  'system',
  'pdf',
  'word',
  'csv',
  'headquarters',
  'shengxu',
  'linxi',
  'website',
] as const;

export class ClientOperationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID('4') eventId!: string;
  @ApiProperty({ enum: CLIENT_PAGES })
  @IsIn(CLIENT_PAGES)
  page!: (typeof CLIENT_PAGES)[number];
  @ApiProperty({ enum: Object.keys(CLIENT_ACTIONS) })
  @IsIn(Object.keys(CLIENT_ACTIONS))
  action!: keyof typeof CLIENT_ACTIONS;
  @ApiProperty({ enum: CLIENT_RESULTS })
  @IsIn(CLIENT_RESULTS)
  result!: (typeof CLIENT_RESULTS)[number];
  @ApiProperty({ format: 'date-time' })
  @IsDateString({ strict: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  occurredAt!: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  recordId?: string;
  @ApiPropertyOptional({ enum: CLIENT_VALUES })
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(CLIENT_VALUES)
  value?: (typeof CLIENT_VALUES)[number];
}

export function clientEntry(
  input: ClientOperationDto,
  user: AuthenticatedUser | undefined,
  ip: string,
): OperationEntry {
  // A retry has the same database primary key. Scope it to the verified identity.
  const hex = createHash('sha256')
    .update(
      [
        'travelops-ui',
        user?.identityId ?? 'anonymous',
        input.eventId.toLowerCase(),
      ].join('/'),
    )
    .digest('hex');
  const id = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '8' + hex.slice(13, 16),
    '8' + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
  return {
    id,
    category: 'client',
    action: CLIENT_ACTIONS[input.action],
    result: input.result,
    success: input.result === 'success',
    actorId: user?.id ?? null,
    actorName: user?.username ?? '未认证访客',
    scope: user?.scope ?? 'unknown',
    ip: ip.slice(0, 64),
    detail: JSON.stringify({
      source: 'client',
      page: input.page,
      action: input.action,
      occurredAt: input.occurredAt,
      ...(input.recordId ? { recordId: input.recordId } : {}),
      ...(input.value ? { value: input.value } : {}),
    }),
  };
}
