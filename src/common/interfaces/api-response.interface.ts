export interface ApiResponse<T> {
  code: 'SUCCESS';
  message: string;
  data: T;
}
