-- 每台空调一段独立 CREATE VIEW；在 SSMS 中执行。
-- 源表时间列假定为 Ct；F2 压力单位需确认为 kPa。
-- 缺失或语义未确认的指标保留 NULL；已有同名视图时 CREATE 会报错。
USE [EMS5.2.2];
GO
SET ANSI_NULLS ON;
GO
SET QUOTED_IDENTIFIER ON;
GO

-- K01
CREATE VIEW [dbo].[KTStartData_K01] AS
SELECT
    [Ct] AS [CT],
    CAST([F5] AS float) AS [workshop_temp_avg],
    CAST([F6] AS float) AS [workshop_humidity_avg],
    CAST([F7] AS float) AS [ac_temp_setpoint],
    CAST([F8] AS float) AS [ac_humidity_setpoint],
    CAST([F35] AS float) AS [fresh_air_temp],
    CAST([F36] AS float) AS [fresh_air_humidity],
    CAST([F11] AS float) AS [supply_air_temp],
    CAST([F12] AS float) AS [supply_air_humidity],
    CAST([F13] AS float) AS [return_air_temp],
    CAST([F14] AS float) AS [return_air_humidity],
    CAST([F15] AS float) AS [mixed_air_temp],
    CAST([F16] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F17] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K02
CREATE VIEW [dbo].[KTStartData_K02] AS
SELECT
    [Ct] AS [CT],
    CAST([F18] AS float) AS [workshop_temp_avg],
    CAST([F19] AS float) AS [workshop_humidity_avg],
    CAST([F20] AS float) AS [ac_temp_setpoint],
    CAST([F21] AS float) AS [ac_humidity_setpoint],
    CAST([F74] AS float) AS [fresh_air_temp],
    CAST([F75] AS float) AS [fresh_air_humidity],
    CAST([F24] AS float) AS [supply_air_temp],
    CAST([F25] AS float) AS [supply_air_humidity],
    CAST([F26] AS float) AS [return_air_temp],
    CAST([F27] AS float) AS [return_air_humidity],
    CAST([F28] AS float) AS [mixed_air_temp],
    CAST([F29] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F30] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K03
CREATE VIEW [dbo].[KTStartData_K03] AS
SELECT
    [Ct] AS [CT],
    CAST([F31] AS float) AS [workshop_temp_avg],
    CAST([F32] AS float) AS [workshop_humidity_avg],
    CAST([F33] AS float) AS [ac_temp_setpoint],
    CAST([F34] AS float) AS [ac_humidity_setpoint],
    CAST([F35] AS float) AS [fresh_air_temp],
    CAST([F36] AS float) AS [fresh_air_humidity],
    CAST([F37] AS float) AS [supply_air_temp],
    CAST([F38] AS float) AS [supply_air_humidity],
    CAST([F39] AS float) AS [return_air_temp],
    CAST([F40] AS float) AS [return_air_humidity],
    CAST([F41] AS float) AS [mixed_air_temp],
    CAST([F42] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F43] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K04
CREATE VIEW [dbo].[KTStartData_K04] AS
SELECT
    [Ct] AS [CT],
    CAST([F44] AS float) AS [workshop_temp_avg],
    CAST([F45] AS float) AS [workshop_humidity_avg],
    CAST([F46] AS float) AS [ac_temp_setpoint],
    CAST([F47] AS float) AS [ac_humidity_setpoint],
    CAST([F61] AS float) AS [fresh_air_temp],
    CAST([F62] AS float) AS [fresh_air_humidity],
    CAST([F50] AS float) AS [supply_air_temp],
    CAST([F51] AS float) AS [supply_air_humidity],
    CAST([F52] AS float) AS [return_air_temp],
    CAST([F53] AS float) AS [return_air_humidity],
    CAST([F54] AS float) AS [mixed_air_temp],
    CAST([F55] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F56] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K05
CREATE VIEW [dbo].[KTStartData_K05] AS
SELECT
    [Ct] AS [CT],
    CAST([F57] AS float) AS [workshop_temp_avg],
    CAST([F58] AS float) AS [workshop_humidity_avg],
    CAST([F59] AS float) AS [ac_temp_setpoint],
    CAST([F60] AS float) AS [ac_humidity_setpoint],
    CAST([F61] AS float) AS [fresh_air_temp],
    CAST([F62] AS float) AS [fresh_air_humidity],
    CAST([F63] AS float) AS [supply_air_temp],
    CAST([F64] AS float) AS [supply_air_humidity],
    CAST([F65] AS float) AS [return_air_temp],
    CAST([F66] AS float) AS [return_air_humidity],
    CAST([F67] AS float) AS [mixed_air_temp],
    CAST([F68] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F69] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K06
CREATE VIEW [dbo].[KTStartData_K06] AS
SELECT
    [Ct] AS [CT],
    CAST([F70] AS float) AS [workshop_temp_avg],
    CAST([F71] AS float) AS [workshop_humidity_avg],
    CAST([F72] AS float) AS [ac_temp_setpoint],
    CAST([F73] AS float) AS [ac_humidity_setpoint],
    CAST([F74] AS float) AS [fresh_air_temp],
    CAST([F75] AS float) AS [fresh_air_humidity],
    CAST([F76] AS float) AS [supply_air_temp],
    CAST([F77] AS float) AS [supply_air_humidity],
    CAST([F78] AS float) AS [return_air_temp],
    CAST([F79] AS float) AS [return_air_humidity],
    CAST([F80] AS float) AS [mixed_air_temp],
    CAST([F81] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F82] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K07
CREATE VIEW [dbo].[KTStartData_K07] AS
SELECT
    [Ct] AS [CT],
    CAST([F83] AS float) AS [workshop_temp_avg],
    CAST([F84] AS float) AS [workshop_humidity_avg],
    CAST([F85] AS float) AS [ac_temp_setpoint],
    CAST([F86] AS float) AS [ac_humidity_setpoint],
    CAST([F74] AS float) AS [fresh_air_temp],
    CAST([F75] AS float) AS [fresh_air_humidity],
    CAST([F89] AS float) AS [supply_air_temp],
    CAST([F90] AS float) AS [supply_air_humidity],
    CAST([F91] AS float) AS [return_air_temp],
    CAST([F92] AS float) AS [return_air_humidity],
    CAST([F93] AS float) AS [mixed_air_temp],
    CAST([F94] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F95] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K08
CREATE VIEW [dbo].[KTStartData_K08] AS
SELECT
    [Ct] AS [CT],
    CAST([F96] AS float) AS [workshop_temp_avg],
    CAST([F97] AS float) AS [workshop_humidity_avg],
    CAST([F98] AS float) AS [ac_temp_setpoint],
    CAST([F99] AS float) AS [ac_humidity_setpoint],
    CAST([F113] AS float) AS [fresh_air_temp],
    CAST([F114] AS float) AS [fresh_air_humidity],
    CAST([F102] AS float) AS [supply_air_temp],
    CAST([F103] AS float) AS [supply_air_humidity],
    CAST([F104] AS float) AS [return_air_temp],
    CAST([F105] AS float) AS [return_air_humidity],
    CAST([F106] AS float) AS [mixed_air_temp],
    CAST([F107] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F108] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K09
CREATE VIEW [dbo].[KTStartData_K09] AS
SELECT
    [Ct] AS [CT],
    CAST([F109] AS float) AS [workshop_temp_avg],
    CAST([F110] AS float) AS [workshop_humidity_avg],
    CAST([F111] AS float) AS [ac_temp_setpoint],
    CAST([F112] AS float) AS [ac_humidity_setpoint],
    CAST([F113] AS float) AS [fresh_air_temp],
    CAST([F114] AS float) AS [fresh_air_humidity],
    CAST([F115] AS float) AS [supply_air_temp],
    CAST([F116] AS float) AS [supply_air_humidity],
    CAST([F117] AS float) AS [return_air_temp],
    CAST([F118] AS float) AS [return_air_humidity],
    CAST([F119] AS float) AS [mixed_air_temp],
    CAST([F120] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F121] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K10
CREATE VIEW [dbo].[KTStartData_K10] AS
SELECT
    [Ct] AS [CT],
    CAST([F122] AS float) AS [workshop_temp_avg],
    CAST([F123] AS float) AS [workshop_humidity_avg],
    CAST([F124] AS float) AS [ac_temp_setpoint],
    CAST([F125] AS float) AS [ac_humidity_setpoint],
    CAST([F139] AS float) AS [fresh_air_temp],
    CAST([F140] AS float) AS [fresh_air_humidity],
    CAST([F128] AS float) AS [supply_air_temp],
    CAST([F129] AS float) AS [supply_air_humidity],
    CAST([F130] AS float) AS [return_air_temp],
    CAST([F131] AS float) AS [return_air_humidity],
    CAST([F132] AS float) AS [mixed_air_temp],
    CAST([F133] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F134] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K11
CREATE VIEW [dbo].[KTStartData_K11] AS
SELECT
    [Ct] AS [CT],
    CAST([F135] AS float) AS [workshop_temp_avg],
    CAST([F136] AS float) AS [workshop_humidity_avg],
    CAST([F137] AS float) AS [ac_temp_setpoint],
    CAST([F138] AS float) AS [ac_humidity_setpoint],
    CAST([F139] AS float) AS [fresh_air_temp],
    CAST([F140] AS float) AS [fresh_air_humidity],
    CAST([F141] AS float) AS [supply_air_temp],
    CAST([F142] AS float) AS [supply_air_humidity],
    CAST([F143] AS float) AS [return_air_temp],
    CAST([F144] AS float) AS [return_air_humidity],
    CAST([F145] AS float) AS [mixed_air_temp],
    CAST([F146] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F147] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K12
CREATE VIEW [dbo].[KTStartData_K12] AS
SELECT
    [Ct] AS [CT],
    CAST([F148] AS float) AS [workshop_temp_avg],
    CAST([F149] AS float) AS [workshop_humidity_avg],
    CAST([F150] AS float) AS [ac_temp_setpoint],
    CAST([F151] AS float) AS [ac_humidity_setpoint],
    CAST([F165] AS float) AS [fresh_air_temp],
    CAST([F166] AS float) AS [fresh_air_humidity],
    CAST([F154] AS float) AS [supply_air_temp],
    CAST([F155] AS float) AS [supply_air_humidity],
    CAST([F156] AS float) AS [return_air_temp],
    CAST([F157] AS float) AS [return_air_humidity],
    CAST([F158] AS float) AS [mixed_air_temp],
    CAST([F159] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F160] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K13
CREATE VIEW [dbo].[KTStartData_K13] AS
SELECT
    [Ct] AS [CT],
    CAST([F161] AS float) AS [workshop_temp_avg],
    CAST([F162] AS float) AS [workshop_humidity_avg],
    CAST([F163] AS float) AS [ac_temp_setpoint],
    CAST([F164] AS float) AS [ac_humidity_setpoint],
    CAST([F165] AS float) AS [fresh_air_temp],
    CAST([F166] AS float) AS [fresh_air_humidity],
    CAST([F167] AS float) AS [supply_air_temp],
    CAST([F168] AS float) AS [supply_air_humidity],
    CAST([F169] AS float) AS [return_air_temp],
    CAST([F170] AS float) AS [return_air_humidity],
    CAST([F171] AS float) AS [mixed_air_temp],
    CAST([F172] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F173] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K14
CREATE VIEW [dbo].[KTStartData_K14] AS
SELECT
    [Ct] AS [CT],
    CAST([F174] AS float) AS [workshop_temp_avg],
    CAST([F175] AS float) AS [workshop_humidity_avg],
    CAST([F176] AS float) AS [ac_temp_setpoint],
    CAST([F177] AS float) AS [ac_humidity_setpoint],
    CAST([F191] AS float) AS [fresh_air_temp],
    CAST([F192] AS float) AS [fresh_air_humidity],
    CAST([F180] AS float) AS [supply_air_temp],
    CAST([F181] AS float) AS [supply_air_humidity],
    CAST([F182] AS float) AS [return_air_temp],
    CAST([F183] AS float) AS [return_air_humidity],
    CAST([F184] AS float) AS [mixed_air_temp],
    CAST([F185] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F186] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K15
CREATE VIEW [dbo].[KTStartData_K15] AS
SELECT
    [Ct] AS [CT],
    CAST([F187] AS float) AS [workshop_temp_avg],
    CAST([F188] AS float) AS [workshop_humidity_avg],
    CAST([F189] AS float) AS [ac_temp_setpoint],
    CAST([F190] AS float) AS [ac_humidity_setpoint],
    CAST([F191] AS float) AS [fresh_air_temp],
    CAST([F192] AS float) AS [fresh_air_humidity],
    CAST([F193] AS float) AS [supply_air_temp],
    CAST([F194] AS float) AS [supply_air_humidity],
    CAST([F195] AS float) AS [return_air_temp],
    CAST([F196] AS float) AS [return_air_humidity],
    CAST([F197] AS float) AS [mixed_air_temp],
    CAST([F198] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F199] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K16
CREATE VIEW [dbo].[KTStartData_K16] AS
SELECT
    [Ct] AS [CT],
    CAST([F200] AS float) AS [workshop_temp_avg],
    CAST([F201] AS float) AS [workshop_humidity_avg],
    CAST([F202] AS float) AS [ac_temp_setpoint],
    CAST([F203] AS float) AS [ac_humidity_setpoint],
    CAST([F191] AS float) AS [fresh_air_temp],
    CAST([F192] AS float) AS [fresh_air_humidity],
    CAST([F206] AS float) AS [supply_air_temp],
    CAST([F207] AS float) AS [supply_air_humidity],
    CAST([F208] AS float) AS [return_air_temp],
    CAST([F209] AS float) AS [return_air_humidity],
    CAST([F210] AS float) AS [mixed_air_temp],
    CAST([F211] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F212] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K17
CREATE VIEW [dbo].[KTStartData_K17] AS
SELECT
    [Ct] AS [CT],
    CAST([F213] AS float) AS [workshop_temp_avg],
    CAST([F214] AS float) AS [workshop_humidity_avg],
    CAST([F215] AS float) AS [ac_temp_setpoint],
    CAST([F216] AS float) AS [ac_humidity_setpoint],
    CAST([F191] AS float) AS [fresh_air_temp],
    CAST([F192] AS float) AS [fresh_air_humidity],
    CAST([F219] AS float) AS [supply_air_temp],
    CAST([F220] AS float) AS [supply_air_humidity],
    CAST([F221] AS float) AS [return_air_temp],
    CAST([F222] AS float) AS [return_air_humidity],
    CAST([F223] AS float) AS [mixed_air_temp],
    CAST([F224] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F225] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K20
CREATE VIEW [dbo].[KTStartData_K20] AS
SELECT
    [Ct] AS [CT],
    CAST([F226] AS float) AS [workshop_temp_avg],
    CAST([F227] AS float) AS [workshop_humidity_avg],
    CAST([F228] AS float) AS [ac_temp_setpoint],
    CAST([F229] AS float) AS [ac_humidity_setpoint],
    CAST([F230] AS float) AS [fresh_air_temp],
    CAST([F231] AS float) AS [fresh_air_humidity],
    CAST([F232] AS float) AS [supply_air_temp],
    CAST([F233] AS float) AS [supply_air_humidity],
    CAST([F234] AS float) AS [return_air_temp],
    CAST([F235] AS float) AS [return_air_humidity],
    CAST([F236] AS float) AS [mixed_air_temp],
    CAST([F237] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F238] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K21
CREATE VIEW [dbo].[KTStartData_K21] AS
SELECT
    [Ct] AS [CT],
    CAST([F239] AS float) AS [workshop_temp_avg],
    CAST([F240] AS float) AS [workshop_humidity_avg],
    CAST([F241] AS float) AS [ac_temp_setpoint],
    CAST([F242] AS float) AS [ac_humidity_setpoint],
    CAST([F230] AS float) AS [fresh_air_temp],
    CAST([F231] AS float) AS [fresh_air_humidity],
    CAST([F245] AS float) AS [supply_air_temp],
    CAST([F246] AS float) AS [supply_air_humidity],
    CAST([F247] AS float) AS [return_air_temp],
    CAST([F248] AS float) AS [return_air_humidity],
    CAST(NULL AS float) AS [mixed_air_temp],
    CAST(NULL AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F249] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K22
CREATE VIEW [dbo].[KTStartData_K22] AS
SELECT
    [Ct] AS [CT],
    CAST([F250] AS float) AS [workshop_temp_avg],
    CAST([F251] AS float) AS [workshop_humidity_avg],
    CAST([F252] AS float) AS [ac_temp_setpoint],
    CAST([F253] AS float) AS [ac_humidity_setpoint],
    CAST([F254] AS float) AS [fresh_air_temp],
    CAST([F255] AS float) AS [fresh_air_humidity],
    CAST([F256] AS float) AS [supply_air_temp],
    CAST([F257] AS float) AS [supply_air_humidity],
    CAST([F258] AS float) AS [return_air_temp],
    CAST([F259] AS float) AS [return_air_humidity],
    CAST(NULL AS float) AS [mixed_air_temp],
    CAST(NULL AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F260] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO

-- K25
CREATE VIEW [dbo].[KTStartData_K25] AS
SELECT
    [Ct] AS [CT],
    CAST([F261] AS float) AS [workshop_temp_avg],
    CAST([F262] AS float) AS [workshop_humidity_avg],
    CAST([F263] AS float) AS [ac_temp_setpoint],
    CAST([F264] AS float) AS [ac_humidity_setpoint],
    CAST([F265] AS float) AS [fresh_air_temp],
    CAST([F266] AS float) AS [fresh_air_humidity],
    CAST([F267] AS float) AS [supply_air_temp],
    CAST([F268] AS float) AS [supply_air_humidity],
    CAST([F269] AS float) AS [return_air_temp],
    CAST([F270] AS float) AS [return_air_humidity],
    CAST([F271] AS float) AS [mixed_air_temp],
    CAST([F272] AS float) AS [mixed_air_humidity],
    CAST([F1] AS float) AS [chilled_water_supply_temp],
    CAST([F2] AS float) AS [chilled_water_supply_pressure],
    CAST(NULL AS float) AS [heat_steam_temp],
    CAST(NULL AS float) AS [heat_steam_pressure],
    CAST(NULL AS float) AS [humidify_steam_temp],
    CAST(NULL AS float) AS [humidify_steam_pressure],
    CAST([F273] AS float) AS [fan_frequency]
FROM [dbo].[GYZky];
GO
