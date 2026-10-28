// 自動生成コード(compiled.js)の型。検証器は呼ぶと真偽を返し、失敗時は .errors に ajv 形式のエラーが入る
type Validator = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };
export const validateMotion: Validator;
export const validateProfile: Validator;
