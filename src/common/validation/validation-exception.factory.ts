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

export function createValidationException(
  errors: ValidationError[],
): BusinessException {
  const details: Record<string, string[]> = {};
  for (const error of errors) collectErrors(error, '', details);

  return new BusinessException({
    code: ErrorCode.VALIDATION_ERROR,
    message: '请求参数校验失败',
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
      containsChinese(message)
        ? message
        : (constraintMessages[constraint] ?? '参数不符合要求'),
  );
  if (messages.length > 0) details[path] = [...new Set(messages)];
  for (const child of error.children ?? []) {
    collectErrors(child, path, details);
  }
}

function containsChinese(message: string): boolean {
  return /[\u3400-\u9fff]/u.test(message);
}
