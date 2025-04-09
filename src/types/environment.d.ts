declare namespace NodeJS {
  export interface ProcessEnv {
    DATABASE_URL: string;

    PK: string;
    ALCHEMY_API_KEY: string;

    CLOB_API_KEY: string;
    CLOB_SECRET: string;
    CLOB_PASS_PHRASE: string;
  }
}
