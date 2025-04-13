interface Window {
  gradio_config: {
    dependencies: {
      api_name: string;
      id: string;
    }[];
  };
}

interface Element {
  app: {
    $$: {
      ctx: any[];
    };
  };
}
