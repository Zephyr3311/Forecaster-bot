declare namespace NodeJS {
  export interface ProcessEnv {
    POSTGRES_HOST: string;
    POSTGRES_USER: string;
    POSTGRES_PASSWORD: string;
    POSTGRES_DB: string;
    DATABASE_URL: string;

    PK: string;
    ALCHEMY_API_KEY: string;

    CLOB_API_KEY: string;
    CLOB_SECRET: string;
    CLOB_PASS_PHRASE: string;
  }
}
