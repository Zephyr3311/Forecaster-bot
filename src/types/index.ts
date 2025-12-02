export enum CallType {
  Invalid = "0",
  Call = "1",
  DelegateCall = "2",
}

export enum OperationType {
  Call, // 0
  DelegateCall, // 1
}

export interface SafeTransaction {
  to: string;
  operation: OperationType;
  data: string;
  value: string;
}
