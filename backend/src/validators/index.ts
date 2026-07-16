export enum UserType {
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR',
  PATIENT = 'PATIENT',
}

export interface JWTPayload {
  user_id: string;
  user_type: UserType;
  session_id?: string;
  token_id?: string;
}

export enum therapy_drug {
  WARFARIN = "Warfarin",
  HEPARIN = "Heparin",
  DABIGATRAN = "Dabigatran",
  RIVAROXABAN = "Rivaroxaban",
  ACITROM = "Acitrom",
}

export enum HealthLog {
  SIDE_EFFECT = 'SIDE_EFFECT',
  ILLNESS = 'ILLNESS',
  LIFESTYLE = 'LIFESTYLE',
  OTHER_MEDS = 'OTHER_MEDS'
}
