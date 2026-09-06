import { customType } from "drizzle-orm/pg-core"

export const pgOid = customType<{ data: number; driverData: number }>({
  dataType: () => "oid",
  fromDriver: Number,
  toDriver: (value) => value
})

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea"
})

export const int8Number = customType<{ data: number; driverData: string }>({
  dataType: () => "bigint",
  fromDriver: Number,
  toDriver: String
})

export const int8BigInt = customType<{ data: bigint; driverData: string }>({
  dataType: () => "bigint",
  fromDriver: BigInt,
  toDriver: String
})
