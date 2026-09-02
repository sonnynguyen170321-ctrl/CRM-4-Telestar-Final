declare module "papaparse" {
  export type ParseError = {
    type: string;
    code: string;
    message: string;
    row?: number;
  };

  export type ParseMeta = {
    fields?: string[];
  };

  export type ParseResult<T> = {
    data: T[];
    errors: ParseError[];
    meta: ParseMeta;
  };

  export type ParseConfig<T> = {
    header?: boolean;
    skipEmptyLines?: boolean | "greedy";
    complete?: (results: ParseResult<T>) => void;
    error?: (error: Error) => void;
  };

  const Papa: {
    parse<T>(file: File, config: ParseConfig<T>): void;
  };

  export default Papa;
}
