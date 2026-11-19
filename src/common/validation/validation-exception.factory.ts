import { HttpStatus } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { ErrorCode } from '../constants/error-code';
import { BusinessException } from '../exceptions/business.exception';

const constraintMessages: Record<string, string> = {
  arrayMaxSize: '数组项目数量超过上限',
  arrayMinSize: '数组项目数量不足',
  arrayNotEmpty: '数组不能为空',
  arrayUnique: '数组项目不能重复',
  isArray: '必须为数组',
  isBoolean: '必须为布尔值',
  isDateString: '必须为有效日期',
  isDefined: '不能为空',
  isEmail: '格式不正确',
  isEnum: '取值无效',
  isIn: '取值无效',
  isInt: '必须为整数',
  isNotEmpty: '不能为空',
  isNumber: '必须为数字',
  isString: '必须为字符串',
  isUUID: '必须为有效 UUID',
  length: '长度不符合要求',
  matches: '格式不正确',
  max: '数值超过上限',
  maxLength: '长度超过上限',
  min: '数值低于下限',
  minLength: '长度不足',
  whitelistValidation: '不允许提交该字段',
};

const fieldLabels: Record<string, string> = {
  name: '名称',
  title: '标题',
  province: '省份 / 地区',
  longitude: '经度',
  latitude: '纬度',
  code: '编号',
  startDate: '开始日期',
  endDate: '结束日期',
  version: '版本',
  status: '状态',
  pax: '人数',
  paxTiers: '人数档位',
  dailyPlans: '每日行程',
  date: '日期',
  dayNumber: '行程日',
  phone: '电话',
  username: '用户名',
  password: '密码',
  email: '邮箱',
  page: '页码',
  pageSize: '每页条数',
  stage: '业务阶段',
  scenario: '场景',
  content: '内容',
  id: '记录标识',
  ids: '记录标识',
  leaderRoomTotal: '领队用房（总计）',
  driverTipTotal: '司机小费（总计）',
  guideLeaderTransportTotal: '导游领队交通费（总计）',
  groundHandlingUnitCost: '地接操作费（每人）',
  singleSupplementQuote: '单房差报价',
  quote: '报价',
  options: '报价方案',
  paxPrices: '档位价格',
};

function validationReason(
  field: string,
  rule: string,
  message: string,
): string {
  if (containsChinese(message)) return message;
  if (
    (field === 'latitude' || field === 'longitude') &&
    (rule === 'min' || rule === 'max')
  ) {
    return field === 'latitude'
      ? '须在 −90 到 90 之间'
      : '须在 −180 到 180 之间';
  }
  const bound = message.match(
    /(-?\d+(?:\.\d+)?)(?: characters?| elements?)?$/,
  )?.[1];
  if (bound) {
    if (rule === 'max') return `不能大于 ${bound}`;
    if (rule === 'min') return `不能小于 ${bound}`;
    if (rule === 'maxLength') return `最多可填写 ${bound} 个字符`;
    if (rule === 'minLength') return `至少需要 ${bound} 个字符`;
  }
  return constraintMessages[rule] ?? '格式或取值不正确';
}

export function createValidationException(
  errors: ValidationError[],
): BusinessException {
  const details: Record<string, string[]> = {};
  for (const error of errors) collectErrors(error, '', details);

  const [first] = Object.entries(details);
  const field = first?.[0]
    .split('.')
    .map((part) =>
      /^\d+$/.test(part)
        ? `第${Number(part) + 1}项`
        : Object.hasOwn(fieldLabels, part)
          ? fieldLabels[part]
          : part,
    )
    .join(' / ');
  return new BusinessException({
    code: ErrorCode.VALIDATION_ERROR,
    message: first ? `「${field}」${first[1][0]}` : '请检查填写内容后重试。',
    status: HttpStatus.BAD_REQUEST,
    details,
  });
}

function collectErrors(
  error: ValidationError,
  parentPath: string,
  details: Record<string, string[]>,
): void {
  const path = parentPath ? `${parentPath}.${error.property}` : error.property;
  const messages = Object.entries(error.constraints ?? {}).map(
    ([constraint, message]) =>
      validationReason(error.property, constraint, message),
  );
  if (messages.length > 0) details[path] = [...new Set(messages)];
  for (const child of error.children ?? []) {
    collectErrors(child, path, details);
  }
}

function containsChinese(message: string): boolean {
  return /[\u3400-\u9fff]/u.test(message);
}
