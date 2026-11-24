/** Auto-synced from web/research/strategy_presets.py — do not hand-edit. */
import type { StrategyPreset } from '@/services/strategyPresets';

const officialPresetsFallback: StrategyPreset[] = [
  {
    "id": "eod_intraday_strength",
    "name": "尾盘分时强势",
    "horizon": "short",
    "version": 1,
    "risk_level": "medium",
    "enabled_by_default": true,
    "runnable": true,
    "run_engine": "eod_intraday",
    "tags": [
      "尾盘",
      "分时",
      "一日持股"
    ],
    "environment": {
      "prefer": [
        "情绪活跃",
        "主线明确"
      ],
      "avoid": [
        "缩量阴跌",
        "退潮期"
      ]
    },
    "gates": {
      "block_on_emotion": [
        "retreat"
      ]
    },
    "rules": {
      "all": [
        {
          "op": "quote.market_cap",
          "params": {
            "min": 50,
            "max": 200
          }
        },
        {
          "op": "quote.volume_ratio",
          "params": {
            "min": 1.2
          }
        },
        {
          "op": "quote.change_percent",
          "params": {
            "min": 3,
            "max": 5
          }
        },
        {
          "op": "quote.turnover_rate",
          "params": {
            "min": 5,
            "max": 10
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        },
        {
          "op": "intraday.timeline_above_avg",
          "params": {
            "min": 80
          }
        }
      ]
    },
    "copy": {
      "headline": "尾盘分时强势（一日持股）",
      "one_liner": "筛选尾盘仍站稳分时均线上方的中小盘强势股，作为短线观察池。",
      "fit_when": "成交活跃、题材有主线、涨停梯队尚可",
      "avoid_when": "情绪退潮、大盘缩量阴跌、独苗无板块效应",
      "how_to_buy": "以观察与尾盘确认主；不作为自动打板指令",
      "how_to_exit": "次日不及预期或分时转弱即退出；单笔亏损纪律收紧",
      "position_hint": "单票轻仓；同时持仓宜少，留现金",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "changePercent",
      "timelineAboveAvgRatio",
      "turnoverRate",
      "circulatingMarketCap",
      "volumeRatio"
    ],
    "sort_default": {
      "field": "timelineAboveAvgRatio",
      "order": "desc"
    },
    "outputs": {
      "allow_trade_card": true,
      "require_tradability_flag": true
    }
  },
  {
    "id": "limit_up_watch",
    "name": "涨停梯队观察",
    "horizon": "short",
    "version": 1,
    "risk_level": "high",
    "enabled_by_default": true,
    "runnable": false,
    "run_engine": "pending",
    "tags": [
      "涨停",
      "龙头",
      "观察池"
    ],
    "environment": {
      "prefer": [
        "发酵/主升",
        "主线辨识度高"
      ],
      "avoid": [
        "退潮",
        "监管压制连板"
      ]
    },
    "gates": {
      "block_on_emotion": [
        "retreat"
      ]
    },
    "rules": {
      "all": [
        {
          "op": "limit.board_count",
          "params": {
            "min": 1,
            "max": 3
          }
        },
        {
          "op": "board.theme_top_n",
          "params": {
            "n": 5
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        },
        {
          "op": "risk.tradability",
          "params": {
            "require_flag": true
          }
        }
      ]
    },
    "copy": {
      "headline": "涨停梯队观察池",
      "one_liner": "从涨停结构中筛首板～三板、且落在当日主线板块内的标的，仅作观察。",
      "fit_when": "情绪启动/发酵、板块梯队完整",
      "avoid_when": "连板高度持续下降、炸板率上升、退潮期",
      "how_to_buy": "不自动给出打板指令；一字板标记为不可成交",
      "how_to_exit": "破板无承接、题材切换、情绪退潮即放弃",
      "position_hint": "高风险；默认不建议重仓，需人工确认龙头地位",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "board_count",
      "theme",
      "changePercent",
      "tradability"
    ],
    "sort_default": {
      "field": "board_count",
      "order": "desc"
    },
    "outputs": {
      "allow_trade_card": false,
      "require_tradability_flag": true
    }
  },
  {
    "id": "breakout_volume",
    "name": "放量突破",
    "horizon": "swing",
    "version": 1,
    "risk_level": "medium_high",
    "enabled_by_default": true,
    "runnable": true,
    "run_engine": "research_scanner",
    "scanner_template_id": "breakout_volume",
    "tags": [
      "突破",
      "放量",
      "右侧"
    ],
    "environment": {
      "prefer": [
        "量价齐升",
        "板块同步走强"
      ],
      "avoid": [
        "无量假突破",
        "大盘弱势强行突破"
      ]
    },
    "gates": {},
    "rules": {
      "all": [
        {
          "op": "breakout.volume",
          "params": {
            "lookback": 20,
            "volume_multiple": 1.8
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        },
        {
          "op": "risk.tradability",
          "params": {
            "require_flag": true
          }
        }
      ]
    },
    "copy": {
      "headline": "放量突破筛选",
      "one_liner": "近 N 日新高或平台上沿伴随成交量放大，作为右侧突破观察池。",
      "fit_when": "趋势市、板块共振",
      "avoid_when": "震荡市假突破多、突破日长上影试盘",
      "how_to_buy": "突破当日或回踩不破再确认；牺牲部分利润换胜率",
      "how_to_exit": "跌回平台/箱体内视为假突破，立即离场",
      "position_hint": "试探仓确认后再加；单笔止损前置",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "breakout",
      "volume_multiple",
      "changePercent"
    ],
    "sort_default": {
      "field": "volume_multiple",
      "order": "desc"
    },
    "outputs": {
      "allow_trade_card": true,
      "require_tradability_flag": true
    }
  },
  {
    "id": "dual_ma_coil",
    "name": "双线擒牛",
    "horizon": "swing",
    "version": 1,
    "risk_level": "medium",
    "enabled_by_default": true,
    "runnable": true,
    "run_engine": "research_scanner",
    "scanner_template_id": "dual_ma_coil",
    "tags": [
      "双线",
      "60/89",
      "波段"
    ],
    "environment": {
      "prefer": [
        "中长期均线粘合后向上"
      ],
      "avoid": [
        "双线之下",
        "死叉确认"
      ]
    },
    "gates": {},
    "rules": {
      "all": [
        {
          "op": "ma.dual_coil",
          "params": {
            "slow": 60,
            "slower": 89,
            "max_gap_pct": 3.0,
            "require_price_above": true
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        }
      ]
    },
    "copy": {
      "headline": "双线擒牛（60/89）",
      "one_liner": "中长期均线紧密粘合或向上发散，且股价站稳双线之上，关注主升前段。",
      "fit_when": "筹码充分换手后、有放量突破迹象",
      "avoid_when": "股价在双线之下、5/10 日死叉且无承接",
      "how_to_buy": "双线之上关注；突破放量更佳",
      "how_to_exit": "跌破双线或短均线死叉执行离场纪律",
      "position_hint": "波段仓位；趋势模糊时降仓",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "ma60",
      "ma89",
      "gap_pct",
      "changePercent"
    ],
    "sort_default": {
      "field": "gap_pct",
      "order": "asc"
    },
    "outputs": {
      "allow_trade_card": true,
      "require_tradability_flag": true
    }
  },
  {
    "id": "ma_bull_stack",
    "name": "均线多头波段",
    "horizon": "swing",
    "version": 1,
    "risk_level": "medium",
    "enabled_by_default": true,
    "runnable": true,
    "run_engine": "research_scanner",
    "scanner_template_id": "ma_bull_stack",
    "tags": [
      "均线",
      "多头",
      "波段"
    ],
    "environment": {
      "prefer": [
        "指数在中期均线上方或箱体震荡"
      ],
      "avoid": [
        "单边急跌",
        "60日线走平向下"
      ]
    },
    "gates": {},
    "rules": {
      "all": [
        {
          "op": "ma.bull_stack",
          "params": {
            "periods": [
              5,
              10,
              20,
              60
            ],
            "require_price_above": 60
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        },
        {
          "op": "risk.tradability",
          "params": {
            "require_flag": true
          }
        }
      ]
    },
    "copy": {
      "headline": "均线多头波段筛选",
      "one_liner": "要求短中期均线多头排列且股价站上 60 日线，作为波段右侧候选。",
      "fit_when": "中期趋势明确、板块有轮动主线",
      "avoid_when": "均线粘合后向下、高位乖离过大、系统性弱势",
      "how_to_buy": "优先回踩 20/60 日线缩量企稳后再确认；不抄看起来便宜的底",
      "how_to_exit": "有效跌破 60 日线或 20 日线走平向下则减仓/离场",
      "position_hint": "底仓为主，单票不宜过重；顺势加仓用正金字塔",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "above_ma60",
      "ma_stack",
      "changePercent",
      "amount"
    ],
    "sort_default": {
      "field": "amount",
      "order": "desc"
    },
    "outputs": {
      "allow_trade_card": true,
      "require_tradability_flag": true
    }
  },
  {
    "id": "volume_price_rise",
    "name": "量价齐升",
    "horizon": "swing",
    "version": 1,
    "risk_level": "medium",
    "enabled_by_default": true,
    "runnable": true,
    "run_engine": "research_scanner",
    "scanner_template_id": "volume_price_rise",
    "tags": [
      "量价",
      "齐升",
      "波段"
    ],
    "environment": {
      "prefer": [
        "趋势上行",
        "板块有共振"
      ],
      "avoid": [
        "量增价滞",
        "高位换手派发",
        "无量阴跌"
      ]
    },
    "gates": {},
    "rules": {
      "all": [
        {
          "op": "volume.price_sync_rise",
          "params": {
            "lookback": 12,
            "min_price_rise_pct": 8.0,
            "min_vol_ratio": 1.5,
            "min_sync_ratio": 0.55,
            "max_price_up_vol_down": 3,
            "near_high_pct": 5.0,
            "min_price_up_days": 4
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        },
        {
          "op": "risk.tradability",
          "params": {
            "require_flag": true
          }
        }
      ]
    },
    "copy": {
      "headline": "量价齐升筛选",
      "one_liner": "近两周收盘与成交量总体抬升，上涨日多数伴随放量，允许少量例外，贴近窗口高点。",
      "fit_when": "右侧趋势启动或加速段、板块同步走强",
      "avoid_when": "量增价不涨、高位换手过高、孤立个股无板块效应",
      "how_to_buy": "连续放量阳线后，回踩 5 日线不破再确认；不追一日极端放量长上影",
      "how_to_exit": "量增价滞、跌破近端平台或 5/10 日线走坏则减仓/离场",
      "position_hint": "波段试探仓；确认趋势后再加，单笔止损前置",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "price_rise_pct",
      "vol_ratio",
      "sync_ratio",
      "changePercent",
      "amount"
    ],
    "sort_default": {
      "field": "vol_ratio",
      "order": "desc"
    },
    "outputs": {
      "allow_trade_card": true,
      "require_tradability_flag": true
    }
  },
  {
    "id": "dividend_roe",
    "name": "高股息+高ROE",
    "horizon": "long",
    "version": 1,
    "risk_level": "low_medium",
    "enabled_by_default": true,
    "runnable": true,
    "run_engine": "research_scanner",
    "scanner_template_id": "dividend_roe",
    "tags": [
      "红利",
      "ROE",
      "长线"
    ],
    "environment": {
      "prefer": [
        "利率下行",
        "震荡防守"
      ],
      "avoid": [
        "成长抱团单边"
      ]
    },
    "gates": {},
    "rules": {
      "all": [
        {
          "op": "valuation.dividend",
          "params": {
            "min": 3,
            "years": 3
          }
        },
        {
          "op": "fina.roe",
          "params": {
            "min": 10,
            "years": 3
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        }
      ]
    },
    "copy": {
      "headline": "高股息+高ROE双筛",
      "one_liner": "连续分红与较高 ROE 提供安全垫，避免股价下跌造成的被动高股息陷阱。",
      "fit_when": "无风险利率下行、市场震荡",
      "avoid_when": "分红不可持续、现金流无法覆盖分红",
      "how_to_buy": "股息率处于相对高位时分批纳入观察/建仓",
      "how_to_exit": "ROE 趋势恶化、分红覆盖失效、估值进入历史极高分位",
      "position_hint": "适合作为组合红利底仓候选，而非短线博弈",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "dividend_yield",
      "roe",
      "pe",
      "pb"
    ],
    "sort_default": {
      "field": "dividend_yield",
      "order": "desc"
    },
    "outputs": {
      "allow_trade_card": true,
      "require_tradability_flag": true
    }
  },
  {
    "id": "growth_trend",
    "name": "成长趋势",
    "horizon": "long",
    "version": 1,
    "risk_level": "medium",
    "enabled_by_default": true,
    "runnable": true,
    "run_engine": "research_scanner",
    "scanner_template_id": "growth_trend",
    "tags": [
      "成长",
      "趋势",
      "PEG"
    ],
    "environment": {
      "prefer": [
        "产业趋势明确",
        "牛市或复苏"
      ],
      "avoid": [
        "景气证伪",
        "估值透支"
      ]
    },
    "gates": {},
    "rules": {
      "all": [
        {
          "op": "fina.growth",
          "params": {
            "revenue_min": 15,
            "profit_min": 15
          }
        },
        {
          "op": "ma.above",
          "params": {
            "period": 60
          }
        },
        {
          "op": "valuation.peg",
          "params": {
            "max": 1.5
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        }
      ]
    },
    "copy": {
      "headline": "成长趋势筛选",
      "one_liner": "业绩增速达标、股价站上中期均线，并用 PEG 约束极端估值（数据缺失则降级）。",
      "fit_when": "产业景气向上、风格偏成长",
      "avoid_when": "增速靠一次性收益、高估值杀业绩",
      "how_to_buy": "确认内生增长后再分批；技术面仅作择时过滤",
      "how_to_exit": "景气证伪、PEG 严重失真、趋势破位且基本面恶化",
      "position_hint": "弹性仓；与红利/质量底仓搭配，控制单一赛道暴露",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "growth",
      "peg",
      "above_ma60",
      "pe"
    ],
    "sort_default": {
      "field": "growth",
      "order": "desc"
    },
    "outputs": {
      "allow_trade_card": true,
      "require_tradability_flag": true
    }
  },
  {
    "id": "quality_value",
    "name": "质量+低估值",
    "horizon": "long",
    "version": 1,
    "risk_level": "low_medium",
    "enabled_by_default": true,
    "runnable": true,
    "run_engine": "research_scanner",
    "scanner_template_id": "quality_value",
    "tags": [
      "质量",
      "估值",
      "长线"
    ],
    "environment": {
      "prefer": [
        "估值低位",
        "防守风格"
      ],
      "avoid": [
        "纯主题炒作高潮"
      ]
    },
    "gates": {},
    "rules": {
      "all": [
        {
          "op": "valuation.pe_pb_pct",
          "params": {
            "pe_percentile_max": 30,
            "pb_percentile_max": 40
          }
        },
        {
          "op": "fina.roe",
          "params": {
            "min": 12,
            "years": 3
          }
        },
        {
          "op": "quote.exclude_st",
          "params": {
            "enabled": true
          }
        },
        {
          "op": "risk.tradability",
          "params": {
            "require_flag": true
          }
        }
      ]
    },
    "copy": {
      "headline": "质量+低估值筛选",
      "one_liner": "PE/PB 截面分位偏低，并尽量叠加 ROE 质量过滤，排除 ST。",
      "fit_when": "熊市/震荡、追求安全边际",
      "avoid_when": "价值陷阱（业绩持续下滑）未排除时",
      "how_to_buy": "分批建仓；先读懂商业模式再加大仓位",
      "how_to_exit": "以逻辑破坏/基本面恶化/估值极端为主，而非单纯跌价",
      "position_hint": "可作为长线观察池；单票受组合上限约束",
      "disclaimer": "规则候选池，仅供观察与学习，不构成投资建议。"
    },
    "result_columns": [
      "pe_percentile",
      "pb_percentile",
      "roe",
      "pe",
      "pb"
    ],
    "sort_default": {
      "field": "pe_percentile",
      "order": "desc"
    },
    "outputs": {
      "allow_trade_card": true,
      "require_tradability_flag": true
    }
  }
];

export default officialPresetsFallback;
