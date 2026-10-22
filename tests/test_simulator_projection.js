'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const currentUrl=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/var SIM_URL="([^"]+)"/)[1];
const embedded=new URL(currentUrl,'https://projection.fixture.test').pathname.replace(/^\//,'');
const files=[...new Set(['simulator.html',embedded])];
function load(file){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  const start=html.indexOf('function projectInvestment(');
  assert.ok(start>=0,file+' must expose the pure common projection');
  const end=html.indexOf('\nfunction ',start+1);
  assert.ok(end>start,file+' common projection must precede the next top-level function');
  const source=html.slice(start,end);
  return {source,project:vm.runInNewContext(source+'\nprojectInvestment',{}, {filename:file+':projectInvestment'})};
}
const implementations=files.map(file=>({file,...load(file)}));
const plain=value=>JSON.parse(JSON.stringify(value));
// Independent oracle constants: 75-digit Decimal recurrence with effective annual
// growth. Every period: balance=(balance+payment)*growth. No annuity closed form.
// Monetary values are rounded only at year/display boundaries using input scale.
// The generator is retained in the work evidence, not imported by these tests.
const cases=[
  {
    "name": "daily-default",
    "input": {
      "mode": "daily",
      "amount": 500,
      "annualRate": 5,
      "years": 20
    },
    "expected": {
      "principal": 3650000,
      "finalAmount": 6184587,
      "gain": 2534587,
      "annualContribution": 182500,
      "principalSeries": [
        182500,
        365000,
        547500,
        730000,
        912500,
        1095000,
        1277500,
        1460000,
        1642500,
        1825000,
        2007500,
        2190000,
        2372500,
        2555000,
        2737500,
        2920000,
        3102500,
        3285000,
        3467500,
        3650000
      ],
      "totalSeries": [
        187038,
        383428,
        589637,
        806157,
        1033502,
        1272215,
        1522864,
        1786045,
        2062385,
        2352543,
        2657208,
        2977106,
        3312999,
        3665687,
        4036009,
        4424848,
        4833128,
        5261822,
        5711951,
        6184587
      ],
      "precision": 0
    }
  },
  {
    "name": "monthly-default",
    "input": {
      "mode": "monthly",
      "amount": 100000,
      "annualRate": 5,
      "years": 20
    },
    "expected": {
      "principal": 24000000,
      "finalAmount": 40745778,
      "gain": 16745778,
      "annualContribution": 1200000,
      "principalSeries": [
        1200000,
        2400000,
        3600000,
        4800000,
        6000000,
        7200000,
        8400000,
        9600000,
        10800000,
        12000000,
        13200000,
        14400000,
        15600000,
        16800000,
        18000000,
        19200000,
        20400000,
        21600000,
        22800000,
        24000000
      ],
      "totalSeries": [
        1232258,
        2526128,
        3884693,
        5311185,
        6809002,
        8381710,
        10033053,
        11766963,
        13587569,
        15499206,
        17506424,
        19614003,
        21826960,
        24150566,
        26590352,
        29152128,
        31841992,
        34666349,
        37631924,
        40745778
      ],
      "precision": 0
    }
  },
  {
    "name": "lump-default",
    "input": {
      "mode": "lump",
      "amount": 1000000,
      "annualRate": 5,
      "years": 20
    },
    "expected": {
      "principal": 1000000,
      "finalAmount": 2653298,
      "gain": 1653298,
      "annualContribution": 1000000,
      "principalSeries": [
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000,
        1000000
      ],
      "totalSeries": [
        1050000,
        1102500,
        1157625,
        1215506,
        1276282,
        1340096,
        1407100,
        1477455,
        1551328,
        1628895,
        1710339,
        1795856,
        1885649,
        1979932,
        2078928,
        2182875,
        2292018,
        2406619,
        2526950,
        2653298
      ],
      "precision": 0
    }
  },
  {
    "name": "daily-one-year",
    "input": {
      "mode": "daily",
      "amount": 1000,
      "annualRate": 5,
      "years": 1
    },
    "expected": {
      "principal": 365000,
      "finalAmount": 374076,
      "gain": 9076,
      "annualContribution": 365000,
      "principalSeries": [
        365000
      ],
      "totalSeries": [
        374076
      ],
      "precision": 0
    }
  },
  {
    "name": "monthly-one-year",
    "input": {
      "mode": "monthly",
      "amount": 100000,
      "annualRate": 5,
      "years": 1
    },
    "expected": {
      "principal": 1200000,
      "finalAmount": 1232258,
      "gain": 32258,
      "annualContribution": 1200000,
      "principalSeries": [
        1200000
      ],
      "totalSeries": [
        1232258
      ],
      "precision": 0
    }
  },
  {
    "name": "monthly-below-native-min",
    "input": {
      "mode": "monthly",
      "amount": 30000,
      "annualRate": 5,
      "years": 20
    },
    "expected": {
      "principal": 7200000,
      "finalAmount": 12223733,
      "gain": 5023733,
      "annualContribution": 360000,
      "principalSeries": [
        360000,
        720000,
        1080000,
        1440000,
        1800000,
        2160000,
        2520000,
        2880000,
        3240000,
        3600000,
        3960000,
        4320000,
        4680000,
        5040000,
        5400000,
        5760000,
        6120000,
        6480000,
        6840000,
        7200000
      ],
      "totalSeries": [
        369677,
        757839,
        1165408,
        1593355,
        2042701,
        2514513,
        3009916,
        3530089,
        4076271,
        4649762,
        5251927,
        5884201,
        6548088,
        7245170,
        7977106,
        8745638,
        9552598,
        10399905,
        11289577,
        12223733
      ],
      "precision": 0
    }
  },
  {
    "name": "monthly-above-native-max",
    "input": {
      "mode": "monthly",
      "amount": 4000000,
      "annualRate": 5,
      "years": 2
    },
    "expected": {
      "principal": 96000000,
      "finalAmount": 101045136,
      "gain": 5045136,
      "annualContribution": 48000000,
      "principalSeries": [
        48000000,
        96000000
      ],
      "totalSeries": [
        49290310,
        101045136
      ],
      "precision": 0
    }
  },
  {
    "name": "fractional-money-and-rate",
    "input": {
      "mode": "monthly",
      "amount": 234567.5,
      "annualRate": 5.12345,
      "years": 3
    },
    "expected": {
      "principal": 8444430,
      "finalAmount": 9129144.7,
      "gain": 684714.7,
      "annualContribution": 2814810,
      "principalSeries": [
        2814810,
        5629620,
        8444430
      ],
      "totalSeries": [
        2892330.4,
        5932847.9,
        9129144.7
      ],
      "precision": 1
    }
  },
  {
    "name": "zero-return-fractional-daily",
    "input": {
      "mode": "daily",
      "amount": 1.005,
      "annualRate": 0,
      "years": 1
    },
    "expected": {
      "principal": 366.825,
      "finalAmount": 366.825,
      "gain": 0,
      "annualContribution": 366.825,
      "principalSeries": [
        366.825
      ],
      "totalSeries": [
        366.825
      ],
      "precision": 3
    }
  },
  {
    "name": "zero-return-fractional-monthly",
    "input": {
      "mode": "monthly",
      "amount": 0.1,
      "annualRate": 0,
      "years": 3
    },
    "expected": {
      "principal": 3.6,
      "finalAmount": 3.6,
      "gain": 0,
      "annualContribution": 1.2,
      "principalSeries": [
        1.2,
        2.4,
        3.6
      ],
      "totalSeries": [
        1.2,
        2.4,
        3.6
      ],
      "precision": 1
    }
  },
  {
    "name": "decimal-lump",
    "input": {
      "mode": "lump",
      "amount": 1234.56,
      "annualRate": 7,
      "years": 3
    },
    "expected": {
      "principal": 1234.56,
      "finalAmount": 1512.39,
      "gain": 277.83,
      "annualContribution": 1234.56,
      "principalSeries": [
        1234.56,
        1234.56,
        1234.56
      ],
      "totalSeries": [
        1320.98,
        1413.45,
        1512.39
      ],
      "precision": 2
    }
  },
  {
    "name": "negative-return-monthly",
    "input": {
      "mode": "monthly",
      "amount": 100000,
      "annualRate": -20,
      "years": 20
    },
    "expected": {
      "principal": 24000000,
      "finalAmount": 5266433,
      "gain": -18733567,
      "annualContribution": 1200000,
      "principalSeries": [
        1200000,
        2400000,
        3600000,
        4800000,
        6000000,
        7200000,
        8400000,
        9600000,
        10800000,
        12000000,
        13200000,
        14400000,
        15600000,
        16800000,
        18000000,
        19200000,
        20400000,
        21600000,
        22800000,
        24000000
      ],
      "totalSeries": [
        1065572,
        1918029,
        2599995,
        3145568,
        3582026,
        3931193,
        4210526,
        4433993,
        4612766,
        4755785,
        4870199,
        4961731,
        5034957,
        5093537,
        5140402,
        5177893,
        5207886,
        5231881,
        5251077,
        5266433
      ],
      "precision": 0
    }
  },
  {
    "name": "negative-return-daily",
    "input": {
      "mode": "daily",
      "amount": 500,
      "annualRate": -50,
      "years": 2
    },
    "expected": {
      "principal": 365000,
      "finalAmount": 197281,
      "gain": -167719,
      "annualContribution": 182500,
      "principalSeries": [
        182500,
        365000
      ],
      "totalSeries": [
        131521,
        197281
      ],
      "precision": 0
    }
  },
  {
    "name": "negative-return-fractional-lump",
    "input": {
      "mode": "lump",
      "amount": 0.125,
      "annualRate": -20,
      "years": 2
    },
    "expected": {
      "principal": 0.125,
      "finalAmount": 0.08,
      "gain": -0.045,
      "annualContribution": 0.125,
      "principalSeries": [
        0.125,
        0.125
      ],
      "totalSeries": [
        0.1,
        0.08
      ],
      "precision": 3
    }
  },
  {
    "name": "half-smallest-unit",
    "input": {
      "mode": "lump",
      "amount": 0.125,
      "annualRate": 0.4,
      "years": 1
    },
    "expected": {
      "principal": 0.125,
      "finalAmount": 0.126,
      "gain": 0.001,
      "annualContribution": 0.125,
      "principalSeries": [
        0.125
      ],
      "totalSeries": [
        0.126
      ],
      "precision": 3
    }
  },
  {
    "name": "smallest-supported-unit",
    "input": {
      "mode": "daily",
      "amount": 1e-12,
      "annualRate": 5,
      "years": 1
    },
    "expected": {
      "principal": 3.65e-10,
      "finalAmount": 3.74e-10,
      "gain": 9e-12,
      "annualContribution": 3.65e-10,
      "principalSeries": [
        3.65e-10
      ],
      "totalSeries": [
        3.74e-10
      ],
      "precision": 12
    }
  },
  {
    "name": "tiny-positive-rate",
    "input": {
      "mode": "monthly",
      "amount": 100000,
      "annualRate": 1e-15,
      "years": 20
    },
    "expected": {
      "principal": 24000000,
      "finalAmount": 24000000,
      "gain": 0,
      "annualContribution": 1200000,
      "principalSeries": [
        1200000,
        2400000,
        3600000,
        4800000,
        6000000,
        7200000,
        8400000,
        9600000,
        10800000,
        12000000,
        13200000,
        14400000,
        15600000,
        16800000,
        18000000,
        19200000,
        20400000,
        21600000,
        22800000,
        24000000
      ],
      "totalSeries": [
        1200000,
        2400000,
        3600000,
        4800000,
        6000000,
        7200000,
        8400000,
        9600000,
        10800000,
        12000000,
        13200000,
        14400000,
        15600000,
        16800000,
        18000000,
        19200000,
        20400000,
        21600000,
        22800000,
        24000000
      ],
      "precision": 0
    }
  },
  {
    "name": "whole-yen-tie",
    "input": {
      "mode": "lump",
      "amount": 100,
      "annualRate": 5.5,
      "years": 1
    },
    "expected": {
      "principal": 100,
      "finalAmount": 106,
      "gain": 6,
      "annualContribution": 100,
      "principalSeries": [
        100
      ],
      "totalSeries": [
        106
      ],
      "precision": 0
    }
  },
  {
    "name": "max-period-zero-rate",
    "input": {
      "mode": "monthly",
      "amount": 100000,
      "annualRate": 0,
      "years": 100
    },
    "expected": {
      "principal": 120000000,
      "finalAmount": 120000000,
      "gain": 0,
      "annualContribution": 1200000,
      "principalSeries": [
        1200000,
        2400000,
        3600000,
        4800000,
        6000000,
        7200000,
        8400000,
        9600000,
        10800000,
        12000000,
        13200000,
        14400000,
        15600000,
        16800000,
        18000000,
        19200000,
        20400000,
        21600000,
        22800000,
        24000000,
        25200000,
        26400000,
        27600000,
        28800000,
        30000000,
        31200000,
        32400000,
        33600000,
        34800000,
        36000000,
        37200000,
        38400000,
        39600000,
        40800000,
        42000000,
        43200000,
        44400000,
        45600000,
        46800000,
        48000000,
        49200000,
        50400000,
        51600000,
        52800000,
        54000000,
        55200000,
        56400000,
        57600000,
        58800000,
        60000000,
        61200000,
        62400000,
        63600000,
        64800000,
        66000000,
        67200000,
        68400000,
        69600000,
        70800000,
        72000000,
        73200000,
        74400000,
        75600000,
        76800000,
        78000000,
        79200000,
        80400000,
        81600000,
        82800000,
        84000000,
        85200000,
        86400000,
        87600000,
        88800000,
        90000000,
        91200000,
        92400000,
        93600000,
        94800000,
        96000000,
        97200000,
        98400000,
        99600000,
        100800000,
        102000000,
        103200000,
        104400000,
        105600000,
        106800000,
        108000000,
        109200000,
        110400000,
        111600000,
        112800000,
        114000000,
        115200000,
        116400000,
        117600000,
        118800000,
        120000000
      ],
      "totalSeries": [
        1200000,
        2400000,
        3600000,
        4800000,
        6000000,
        7200000,
        8400000,
        9600000,
        10800000,
        12000000,
        13200000,
        14400000,
        15600000,
        16800000,
        18000000,
        19200000,
        20400000,
        21600000,
        22800000,
        24000000,
        25200000,
        26400000,
        27600000,
        28800000,
        30000000,
        31200000,
        32400000,
        33600000,
        34800000,
        36000000,
        37200000,
        38400000,
        39600000,
        40800000,
        42000000,
        43200000,
        44400000,
        45600000,
        46800000,
        48000000,
        49200000,
        50400000,
        51600000,
        52800000,
        54000000,
        55200000,
        56400000,
        57600000,
        58800000,
        60000000,
        61200000,
        62400000,
        63600000,
        64800000,
        66000000,
        67200000,
        68400000,
        69600000,
        70800000,
        72000000,
        73200000,
        74400000,
        75600000,
        76800000,
        78000000,
        79200000,
        80400000,
        81600000,
        82800000,
        84000000,
        85200000,
        86400000,
        87600000,
        88800000,
        90000000,
        91200000,
        92400000,
        93600000,
        94800000,
        96000000,
        97200000,
        98400000,
        99600000,
        100800000,
        102000000,
        103200000,
        104400000,
        105600000,
        106800000,
        108000000,
        109200000,
        110400000,
        111600000,
        112800000,
        114000000,
        115200000,
        116400000,
        117600000,
        118800000,
        120000000
      ],
      "precision": 0
    }
  },
  {
    "name": "goal-default",
    "input": {
      "mode": "goal",
      "amount": 10000000,
      "annualRate": 5,
      "years": 20
    },
    "expected": {
      "principal": 5890320,
      "finalAmount": 10000236,
      "gain": 4109916,
      "annualContribution": 294516,
      "principalSeries": [
        294516,
        589032,
        883548,
        1178064,
        1472580,
        1767096,
        2061612,
        2356128,
        2650644,
        2945160,
        3239676,
        3534192,
        3828708,
        4123224,
        4417740,
        4712256,
        5006772,
        5301288,
        5595804,
        5890320
      ],
      "totalSeries": [
        302433,
        619988,
        953420,
        1303524,
        1671133,
        2057123,
        2462412,
        2887966,
        3334797,
        3803970,
        4296602,
        4813865,
        5356991,
        5927273,
        6526070,
        7154807,
        7814980,
        8508162,
        9236003,
        10000236
      ],
      "precision": 0,
      "monthlyContribution": 24543,
      "targetAmount": 10000000
    }
  },
  {
    "name": "goal-zero-return",
    "input": {
      "mode": "goal",
      "amount": 1200000,
      "annualRate": 0,
      "years": 2
    },
    "expected": {
      "principal": 1200000,
      "finalAmount": 1200000,
      "gain": 0,
      "annualContribution": 600000,
      "principalSeries": [
        600000,
        1200000
      ],
      "totalSeries": [
        600000,
        1200000
      ],
      "precision": 0,
      "monthlyContribution": 50000,
      "targetAmount": 1200000
    }
  },
  {
    "name": "goal-negative-return-fraction",
    "input": {
      "mode": "goal",
      "amount": 1000.5,
      "annualRate": -10,
      "years": 3
    },
    "expected": {
      "principal": 1188,
      "finalAmount": 1014.1,
      "gain": -173.9,
      "annualContribution": 396,
      "principalSeries": [
        396,
        792,
        1188
      ],
      "totalSeries": [
        374.2,
        711,
        1014.1
      ],
      "precision": 1,
      "monthlyContribution": 33,
      "targetAmount": 1000.5
    }
  },
  {
    "name": "goal-minimum-payment",
    "input": {
      "mode": "goal",
      "amount": 1e-12,
      "annualRate": 0,
      "years": 1
    },
    "expected": {
      "principal": 12,
      "finalAmount": 12,
      "gain": 0,
      "annualContribution": 12,
      "principalSeries": [
        12
      ],
      "totalSeries": [
        12
      ],
      "precision": 12,
      "monthlyContribution": 1,
      "targetAmount": 1e-12
    }
  }
,
  {
    "name": "cent-half-unit",
    "input": {
      "mode": "lump",
      "amount": 0.01,
      "annualRate": 50,
      "years": 1
    },
    "expected": {
      "principal": 0.01,
      "finalAmount": 0.02,
      "gain": 0.01,
      "annualContribution": 0.01,
      "principalSeries": [
        0.01
      ],
      "totalSeries": [
        0.02
      ],
      "precision": 2
    }
  },
  {
    "name": "three-cent-half-unit",
    "input": {
      "mode": "lump",
      "amount": 0.03,
      "annualRate": 50,
      "years": 1
    },
    "expected": {
      "principal": 0.03,
      "finalAmount": 0.05,
      "gain": 0.02,
      "annualContribution": 0.03,
      "principalSeries": [
        0.03
      ],
      "totalSeries": [
        0.05
      ],
      "precision": 2
    }
  },
  {
    "name": "fifteen-cent-half-unit",
    "input": {
      "mode": "lump",
      "amount": 0.15,
      "annualRate": 50,
      "years": 1
    },
    "expected": {
      "principal": 0.15,
      "finalAmount": 0.23,
      "gain": 0.08,
      "annualContribution": 0.15,
      "principalSeries": [
        0.15
      ],
      "totalSeries": [
        0.23
      ],
      "precision": 2
    }
  },
  {
    "name": "just-below-half-unit",
    "input": {
      "mode": "lump",
      "amount": 0.01,
      "annualRate": 49.9999999,
      "years": 1
    },
    "expected": {
      "principal": 0.01,
      "finalAmount": 0.01,
      "gain": 0,
      "annualContribution": 0.01,
      "principalSeries": [
        0.01
      ],
      "totalSeries": [
        0.01
      ],
      "precision": 2
    }
  },
  {
    "name": "just-above-half-unit",
    "input": {
      "mode": "lump",
      "amount": 0.01,
      "annualRate": 50.0000001,
      "years": 1
    },
    "expected": {
      "principal": 0.01,
      "finalAmount": 0.02,
      "gain": 0.01,
      "annualContribution": 0.01,
      "principalSeries": [
        0.01
      ],
      "totalSeries": [
        0.02
      ],
      "precision": 2
    }
  },
  {
    "name": "goal-exact-integer-payment",
    "input": {
      "mode": "goal",
      "amount": 8190,
      "annualRate": 409500,
      "years": 1
    },
    "expected": {
      "principal": 12,
      "finalAmount": 8190,
      "gain": 8178,
      "annualContribution": 12,
      "principalSeries": [
        12
      ],
      "totalSeries": [
        8190
      ],
      "precision": 0,
      "monthlyContribution": 1,
      "targetAmount": 8190
    }
  }
,
  {
    "name": "goal-below-integer-payment",
    "input": {
      "mode": "goal",
      "amount": 8189.999999,
      "annualRate": 409500,
      "years": 1
    },
    "expected": {
      "principal": 12,
      "finalAmount": 8190,
      "gain": 8178,
      "annualContribution": 12,
      "principalSeries": [
        12
      ],
      "totalSeries": [
        8190
      ],
      "precision": 6,
      "monthlyContribution": 1,
      "targetAmount": 8189.999999
    }
  },
  {
    "name": "goal-above-integer-payment",
    "input": {
      "mode": "goal",
      "amount": 8190.000001,
      "annualRate": 409500,
      "years": 1
    },
    "expected": {
      "principal": 24,
      "finalAmount": 16380,
      "gain": 16356,
      "annualContribution": 24,
      "principalSeries": [
        24
      ],
      "totalSeries": [
        16380
      ],
      "precision": 6,
      "monthlyContribution": 2,
      "targetAmount": 8190.000001
    }
  }
];
for(const {file,project} of implementations){
  for(const row of cases)test(`${file}: independent Decimal cash-flow oracle ${row.name}`,()=>{
    const original=JSON.stringify(row.input),result=plain(project({...row.input}));
    assert.equal(result.valid,true);
    for(const key of ['principal','finalAmount','gain','annualContribution','precision'])assert.equal(result[key],row.expected[key],key);
    assert.deepEqual(result.principalSeries,row.expected.principalSeries,'yearly contributions');
    assert.deepEqual(result.totalSeries,row.expected.totalSeries,'year-end balances');
    assert.equal(result.years,row.input.years);assert.equal(result.annualRate,row.input.annualRate);
    assert.equal(result.labels.length,row.input.years);assert.equal(result.totalSeries.at(-1),result.finalAmount);
    assert.equal(result.principalSeries.at(-1),result.principal);
    assert.equal(JSON.stringify(row.input),original,'projection never rewrites the caller input');
    if(row.input.mode==='goal'){
      assert.equal(result.monthlyContribution,row.expected.monthlyContribution);
      assert.equal(result.targetAmount,row.expected.targetAmount);
      assert.equal(result.principal,result.monthlyContribution*12*result.years);
      assert.ok(result.finalAmount>=result.targetAmount,'the rounded-up actual payment reaches the target');
    }
  });
  test(`${file}: zero annual rate is valid but invalid amounts, periods and domain boundaries are rejected`,()=>{
    const base={mode:'monthly',amount:1000,annualRate:0,years:1};
    assert.equal(project(base).valid,true);
    const invalid=[null,{}, {...base,mode:'unknown'},...['0',0,-1,NaN,Infinity,-Infinity].map(amount=>({...base,amount})),
      ...[-100,-101,NaN,Infinity,-Infinity].map(annualRate=>({...base,annualRate})),
      ...[0,-1,0.5,1.5,101,NaN,Infinity,1e100].map(years=>({...base,years})),
      {...base,amount:1e-13},{...base,mode:'lump',amount:Number.MAX_SAFE_INTEGER,annualRate:100},
      {...base,amount:Number.MAX_SAFE_INTEGER},{...base,mode:'lump',amount:1e20,annualRate:-99},
      // This input fits MAX_SAFE_INTEGER, but exp/log error exceeds safe unit rounding.
      {...base,mode:'lump',amount:5744498642745,annualRate:10,years:74}];
    for(const input of invalid){let result;assert.doesNotThrow(()=>{result=project(input);});assert.equal(result.valid,false,JSON.stringify(input));}
    assert.equal(project({...base,annualRate:-20}).valid,true,'negative return above -100% is supported');
    assert.equal(project({mode:'lump',amount:22220000000,annualRate:0,years:1}).finalAmount,22220000000,'large, exact zero-return amounts remain valid within the precision guard');
  });
  test(`${file}: identical effective annual growth and period-beginning timing hold across modes`,()=>{
    // At one year, a lump deposit grows by the quoted annual percentage exactly.
    assert.equal(project({mode:'lump',amount:1000000,annualRate:5,years:1}).finalAmount,1050000);
    // Fixed independent constants reject both nominal APR/12 and end-period deposits.
    const monthly=project({mode:'monthly',amount:100000,annualRate:5,years:20});
    assert.equal(monthly.finalAmount,40745778);
    assert.notEqual(monthly.finalAmount,41274631,'old nominal annual convention');
    assert.notEqual(monthly.finalAmount,41103367,'old detail end-period nominal convention');
    assert.equal(monthly.annualContribution,1200000,'annual deposits are independent of total saving years');
    const one=project({mode:'monthly',amount:100000,annualRate:5,years:1});assert.equal(one.annualContribution,monthly.annualContribution);
  });
}
test('standalone and currently referenced immutable simulator share the exact common mathematical function',()=>{
  assert.equal(implementations.length,2);
  assert.equal(implementations[0].source,implementations[1].source);
});
