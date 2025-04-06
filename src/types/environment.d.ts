declare namespace NodeJS {
  export interface ProcessEnv {
    PK: string;
    CHAIN_ID: string;
    RPC_URL: string;

    CLOB_API_URL: string;
    CLOB_API_KEY: string;
    CLOB_SECRET: string;
    CLOB_PASS_PHRASE: string;
  }
}
