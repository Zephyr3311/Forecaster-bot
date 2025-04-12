export type LlmArenaLeaderboard = {
  "Rank* (UB)": number;
  "Rank (StyleCtrl)": number;
  Model: string;
  "Arena Score": number;
  "95% CI": string;
  Votes: number;
  Organization: string;
  License: string;
};

export type GradioConfig = {
  version: string;
  mode: string;
  app_id: number;
  dev_mode: boolean;
  analytics_enabled: boolean;
  components: GradioComponent[];
  css: string;
  connect_heartbeat: boolean;
  js: null;
  head: string;
  title: string;
  space_id: null;
  enable_queue: boolean;
  show_error: boolean;
  show_api: boolean;
  is_colab: boolean;
  max_file_size: null;
  stylesheets: string[];
  theme: string;
  protocol: string;
  body_css: GradioBodyCSS;
  fill_height: boolean;
  fill_width: boolean;
  theme_hash: string;
  layout: Layout;
  dependencies: Dependency[];
  root: string;
  username: null;
};

type GradioBodyCSS = {
  body_background_fill: string;
  body_text_color: string;
  body_background_fill_dark: string;
  body_text_color_dark: string;
};

type GradioComponent = {
  id: number;
  type: string;
  props: GradioProps;
  skip_api: boolean;
  component_class_id: string;
  key: null;
  api_info?: GradioAPIInfo;
  example_inputs?:
    | Array<Array<null | string> | string>
    | GradioExampleInputsClass
    | string
    | number
    | null;
};

type GradioAPIInfo = {
  type: string;
  properties?: GradioAPIInfoProperties;
  required?: string[];
  title?: string;
  $defs?: GradioDefs;
  items?: GradioAPIInfoItems;
  description?: string;
  enum?: string[];
};

type GradioDefs = {
  ComponentMessage?: GradioComponentMessage;
  FileData: GradioFileData;
  FileMessage?: GradioFileMessage;
};

type GradioComponentMessage = {
  properties: GradioComponentMessageProperties;
  required: string[];
  title: string;
  type: string;
};

type GradioComponentMessageProperties = {
  component: GradioPath;
  value: GradioPropertiesValue;
  constructor_args: GradioPath;
  props: GradioPath;
};

type GradioPath = {
  title: string;
  type: string;
};

type GradioPropertiesValue = {
  title: string;
};

type GradioFileData = {
  description: string;
  properties: GradioFileDataProperties;
  required: string[];
  title: string;
  type: string;
};

type GradioFileDataProperties = {
  path: GradioPath;
  url: GradioMIMEType;
  size: GradioMIMEType;
  orig_name: GradioMIMEType;
  mime_type: GradioMIMEType;
  is_stream: GradioIsStream;
  meta: GradioPropertiesMeta;
};

type GradioIsStream = {
  default: boolean;
  title: string;
  type: string;
};

type GradioPropertiesMeta = {
  default: GradioDefaultClass;
  title: string;
  type: string;
};

type GradioDefaultClass = {
  _type: string;
};

type GradioMIMEType = {
  anyOf: GradioMIMETypeItems[];
  default: null;
  title: string;
};

type GradioMIMETypeItems = {
  type: string;
};

type GradioFileMessage = {
  properties: GradioFileMessageProperties;
  required: string[];
  title: string;
  type: string;
};

type GradioFileMessageProperties = {
  file: GradioFileClass;
  alt_text: GradioMIMEType;
};

type GradioFileClass = {
  $ref: string;
};

type GradioAPIInfoItems = {
  maxItems?: number;
  minItems?: number;
  prefixItems?: GradioPrefixItem[];
  type: string;
  enum?: string[];
};

type GradioPrefixItem = {
  anyOf: GradioPrefixItemAnyOf[];
};

type GradioPrefixItemAnyOf = {
  type?: string;
  $ref?: string;
};

type GradioAPIInfoProperties = {
  path?: GradioPath;
  url?: GradioMIMEType;
  size?: GradioMIMEType;
  orig_name?: GradioMIMEType;
  mime_type?: GradioMIMEType;
  is_stream?: GradioIsStream;
  meta?: GradioPropertiesMeta;
  text?: GradioPath;
  files?: GradioFiles;
  headers?: GradioHeaders;
  data?: GradioData;
  metadata?: GradioPropertiesMetadata;
  type?: GradioTypeClass;
  plot?: GradioPath;
};

type GradioData = {
  items: GradioDataItems;
  title: string;
  type: string;
};

type GradioDataItems = {
  items?: any[];
  type: string;
};

type GradioFiles = {
  items: GradioFileClass;
  title: string;
  type: string;
};

type GradioHeaders = {
  items: GradioMIMETypeItems;
  title: string;
  type: string;
};

type GradioPropertiesMetadata = {
  anyOf: GradioMetadataAnyOf[];
  default: null;
  title: string;
};

type GradioMetadataAnyOf = {
  additionalProperties?: GradioAdditionalProperties;
  type: string;
};

type GradioAdditionalProperties = {
  anyOf: GradioDataItems[];
};

type GradioTypeClass = {
  enum: string[];
  title: string;
  type: string;
};

type GradioExampleInputsClass = {
  path?: string;
  meta?: GradioDefaultClass;
  orig_name?: string;
  url?: string;
  text?: string;
  files?: any[];
  headers?: string[];
  data?: Array<string[]>;
};

type GradioProps = {
  value: GradioValueValue;
  visible?: boolean;
  name: string;
  label?: string;
  interactive?: boolean;
  id?: number;
  _selectable?: boolean;
  time_to_live?: null;
  delete_callback?: string;
  lines?: number;
  max_lines?: number;
  show_label?: boolean;
  container?: boolean;
  min_width?: number;
  autofocus?: boolean;
  autoscroll?: boolean;
  elem_classes?: any[];
  type?: string;
  rtl?: boolean;
  show_copy_button?: boolean;
  latex_delimiters?: GradioLatexDelimiter[];
  elem_id?: string;
  sanitize_html?: boolean;
  line_breaks?: boolean;
  header_links?: boolean;
  variant?: string;
  equal_height?: boolean;
  show_progress?: boolean;
  scale?: number;
  streamable?: boolean;
  format?: string;
  image_mode?: string;
  sources?: string[];
  show_download_button?: boolean;
  streaming?: boolean;
  mirror_webcam?: boolean;
  show_share_button?: boolean;
  show_fullscreen_button?: boolean;
  open?: boolean;
  likeable?: boolean;
  height?: number;
  avatar_images?: Array<GradioAvatarImage | null>;
  render_markdown?: boolean;
  bubble_full_width?: boolean;
  show_copy_all_button?: boolean;
  placeholder?: string;
  file_types?: string[];
  file_count?: string;
  submit_btn?: boolean;
  component_props?: GradioComponentProp[];
  samples?: Array<string[]>;
  headers?: string[];
  samples_per_page?: number;
  components?: string[];
  component_ids?: number[];
  minimum?: number;
  maximum?: number;
  step?: number;
  choices?: Array<string[]>;
  allow_custom_value?: boolean;
  filterable?: boolean;
  info?: string;
  row_count?: Array<number | string>;
  col_count?: Array<number | string>;
  datatype?: string[];
  wrap?: boolean;
  column_widths?: string[];
};

type GradioAvatarImage = {
  path: string;
  url: string;
  size: null;
  orig_name: null;
  mime_type: null;
  is_stream: boolean;
  meta: GradioDefaultClass;
};

type GradioComponentProp = {
  lines: number;
  max_lines: number;
  placeholder: string;
  label: null | string;
  info: null;
  show_label: boolean;
  container: boolean;
  scale: number | null;
  min_width: number;
  interactive: null;
  visible: boolean;
  elem_id: string;
  autofocus: boolean;
  autoscroll: boolean;
  elem_classes: any[];
  key: null;
  type: string;
  text_align: null;
  rtl: boolean;
  show_copy_button: boolean;
  max_length: null;
};

type GradioLatexDelimiter = {
  left: string;
  right: string;
  display: boolean;
};

type GradioValueValue = {
  inputs?: null[];
  contexts?: null[];
  text_models?: string[];
  all_text_models?: string[];
  vision_models?: string[];
  all_vision_models?: string[];
  image_gen_models?: string[];
  all_image_gen_models?: string[];
  search_models?: any[];
  all_search_models?: any[];
  models?: string[];
  all_models?: string[];
  arena_type?: string;
  text?: string;
  files?: any[];
  headers: string[];
  data: Array<string[]>;
  metadata?: GradioValueMetadata | null;
  type?: string;
  plot?: string;
};

type GradioValueMetadata = {
  display_value: Array<string[]>;
  styling: Array<string[]>;
};

type Dependency = {
  id: number;
  targets: Array<Array<string | number | null>>;
  inputs: number[];
  outputs: number[];
  backend_fn: boolean;
  js: null | string;
  queue: boolean;
  api_name: string;
  scroll_to_output: boolean;
  show_progress: string;
  batch: boolean;
  max_batch_size: number;
  cancels: any[];
  types: Types;
  collects_event_data: boolean;
  trigger_after: number | null;
  trigger_only_on_success: boolean;
  trigger_mode: string;
  show_api: boolean;
  zerogpu: boolean;
  rendered_in: null;
};

type Types = {
  generator: boolean;
  cancel: boolean;
};

type Layout = {
  id: number;
  children: LayoutChild[];
};

type LayoutChild = {
  id: number;
  children?: PurpleChild[];
};

type PurpleChild = {
  id: number;
  children: FluffyChild[];
};

type FluffyChild = {
  id: number;
  children?: TentacledChild[];
};

type TentacledChild = {
  id: number;
  children?: StickyChild[];
};

type StickyChild = {
  id: number;
  children?: IndigoChild[];
};

type IndigoChild = {
  id: number;
  children?: IndecentChild[];
};

type IndecentChild = {
  id: number;
  children?: HilariousChild[];
};

type HilariousChild = {
  id: number;
};
