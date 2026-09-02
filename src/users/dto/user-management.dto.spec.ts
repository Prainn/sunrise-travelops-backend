import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto, UpdateUserDto } from './user-management.dto';

const editableFields = {
  nickname: '王敏',
  avatar: '/favicon.ico',
  gender: 0,
  mobile: '',
  email: 'inquiry@sunrise.local',
  deptId: 3,
  roleIds: ['335e91c5-231b-475c-b875-cd34fb1f7601'],
  status: 1,
};

describe('User management DTOs', () => {
  it('allows user updates without a username', async () => {
    const errors = await validate(
      plainToInstance(UpdateUserDto, editableFields),
    );

    expect(errors).toEqual([]);
  });

  it('still requires a username when creating a user', async () => {
    const errors = await validate(
      plainToInstance(CreateUserDto, editableFields),
    );

    expect(errors.map((error) => error.property)).toContain('username');
  });
});
