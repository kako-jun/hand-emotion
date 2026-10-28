// サンプル JSON と同内容の型付きフィクスチャ。型(src/types/definition.ts)を変えると
// ここが tsc で落ちる(npm run build)。内容一致は types.test.ts が JSON と照合する。
import type { AvatarProfile, MotionDefinition } from '../src/types/definition';

export const typedMotion = {
  "schemaVersion": "0.1.0",
  "id": "arigatou.sign-like",
  "category": "sign-like-gesture",
  "provenance": {
    "status": "unreviewed",
    "source": "hand-authored placeholder; not a reviewed sign"
  },
  "semantic": {
    "label": "ありがとう",
    "reading": "ありがとう",
    "gloss": "THANKS",
    "lang": "ja"
  },
  "duration": 1.2,
  "keyframes": [
    {
      "time": 0,
      "ease": "ease-out",
      "pose": {
        "right": {
          "wrist": {
            "position": [
              0.1,
              0.15,
              0.3
            ],
            "rotation": [
              0,
              0,
              -10
            ]
          },
          "joints": {
            "thumbCmc": [
              0,
              0,
              0
            ],
            "thumbMcp": [
              0,
              0,
              0
            ],
            "thumbIp": [
              0,
              0,
              0
            ],
            "indexMcp": [
              0,
              0,
              0
            ],
            "indexPip": [
              0,
              0,
              0
            ],
            "indexDip": [
              0,
              0,
              0
            ],
            "middleMcp": [
              0,
              0,
              0
            ],
            "middlePip": [
              0,
              0,
              0
            ],
            "middleDip": [
              0,
              0,
              0
            ],
            "ringMcp": [
              0,
              0,
              0
            ],
            "ringPip": [
              0,
              0,
              0
            ],
            "ringDip": [
              0,
              0,
              0
            ],
            "littleMcp": [
              0,
              0,
              0
            ],
            "littlePip": [
              0,
              0,
              0
            ],
            "littleDip": [
              0,
              0,
              0
            ]
          }
        },
        "left": {
          "wrist": {
            "position": [
              0.1,
              -0.05,
              0.2
            ],
            "rotation": [
              0,
              0,
              -10
            ]
          },
          "joints": {
            "thumbCmc": [
              0,
              0,
              0
            ],
            "thumbMcp": [
              0,
              0,
              0
            ],
            "thumbIp": [
              0,
              0,
              0
            ],
            "indexMcp": [
              0,
              0,
              0
            ],
            "indexPip": [
              0,
              0,
              0
            ],
            "indexDip": [
              0,
              0,
              0
            ],
            "middleMcp": [
              0,
              0,
              0
            ],
            "middlePip": [
              0,
              0,
              0
            ],
            "middleDip": [
              0,
              0,
              0
            ],
            "ringMcp": [
              0,
              0,
              0
            ],
            "ringPip": [
              0,
              0,
              0
            ],
            "ringDip": [
              0,
              0,
              0
            ],
            "littleMcp": [
              0,
              0,
              0
            ],
            "littlePip": [
              0,
              0,
              0
            ],
            "littleDip": [
              0,
              0,
              0
            ]
          }
        }
      }
    },
    {
      "time": 0.6,
      "ease": "ease-in-out",
      "hold": 0.2,
      "pose": {
        "right": {
          "wrist": {
            "position": [
              0.1,
              0.05,
              0.35
            ],
            "rotation": [
              30,
              0,
              -10
            ]
          },
          "joints": {
            "thumbCmc": [
              0,
              0,
              0
            ],
            "thumbMcp": [
              0,
              0,
              0
            ],
            "thumbIp": [
              0,
              0,
              0
            ],
            "indexMcp": [
              20,
              0,
              0
            ],
            "indexPip": [
              0,
              0,
              0
            ],
            "indexDip": [
              0,
              0,
              0
            ],
            "middleMcp": [
              20,
              0,
              0
            ],
            "middlePip": [
              0,
              0,
              0
            ],
            "middleDip": [
              0,
              0,
              0
            ],
            "ringMcp": [
              20,
              0,
              0
            ],
            "ringPip": [
              0,
              0,
              0
            ],
            "ringDip": [
              0,
              0,
              0
            ],
            "littleMcp": [
              20,
              0,
              0
            ],
            "littlePip": [
              0,
              0,
              0
            ],
            "littleDip": [
              0,
              0,
              0
            ]
          }
        },
        "left": {
          "wrist": {
            "position": [
              0.1,
              -0.05,
              0.2
            ],
            "rotation": [
              0,
              0,
              -10
            ]
          },
          "joints": {
            "thumbCmc": [
              0,
              0,
              0
            ],
            "thumbMcp": [
              0,
              0,
              0
            ],
            "thumbIp": [
              0,
              0,
              0
            ],
            "indexMcp": [
              0,
              0,
              0
            ],
            "indexPip": [
              0,
              0,
              0
            ],
            "indexDip": [
              0,
              0,
              0
            ],
            "middleMcp": [
              0,
              0,
              0
            ],
            "middlePip": [
              0,
              0,
              0
            ],
            "middleDip": [
              0,
              0,
              0
            ],
            "ringMcp": [
              0,
              0,
              0
            ],
            "ringPip": [
              0,
              0,
              0
            ],
            "ringDip": [
              0,
              0,
              0
            ],
            "littleMcp": [
              0,
              0,
              0
            ],
            "littlePip": [
              0,
              0,
              0
            ],
            "littleDip": [
              0,
              0,
              0
            ]
          }
        }
      }
    },
    {
      "time": 1.2,
      "ease": "ease-in",
      "pose": {
        "right": {
          "wrist": {
            "position": [
              0.1,
              -0.05,
              0.3
            ],
            "rotation": [
              10,
              0,
              -10
            ]
          },
          "joints": {
            "thumbCmc": [
              0,
              0,
              0
            ],
            "thumbMcp": [
              0,
              0,
              0
            ],
            "thumbIp": [
              0,
              0,
              0
            ],
            "indexMcp": [
              0,
              0,
              0
            ],
            "indexPip": [
              0,
              0,
              0
            ],
            "indexDip": [
              0,
              0,
              0
            ],
            "middleMcp": [
              0,
              0,
              0
            ],
            "middlePip": [
              0,
              0,
              0
            ],
            "middleDip": [
              0,
              0,
              0
            ],
            "ringMcp": [
              0,
              0,
              0
            ],
            "ringPip": [
              0,
              0,
              0
            ],
            "ringDip": [
              0,
              0,
              0
            ],
            "littleMcp": [
              0,
              0,
              0
            ],
            "littlePip": [
              0,
              0,
              0
            ],
            "littleDip": [
              0,
              0,
              0
            ]
          }
        },
        "left": {
          "wrist": {
            "position": [
              0.1,
              -0.05,
              0.2
            ],
            "rotation": [
              0,
              0,
              -10
            ]
          },
          "joints": {
            "thumbCmc": [
              0,
              0,
              0
            ],
            "thumbMcp": [
              0,
              0,
              0
            ],
            "thumbIp": [
              0,
              0,
              0
            ],
            "indexMcp": [
              0,
              0,
              0
            ],
            "indexPip": [
              0,
              0,
              0
            ],
            "indexDip": [
              0,
              0,
              0
            ],
            "middleMcp": [
              0,
              0,
              0
            ],
            "middlePip": [
              0,
              0,
              0
            ],
            "middleDip": [
              0,
              0,
              0
            ],
            "ringMcp": [
              0,
              0,
              0
            ],
            "ringPip": [
              0,
              0,
              0
            ],
            "ringDip": [
              0,
              0,
              0
            ],
            "littleMcp": [
              0,
              0,
              0
            ],
            "littlePip": [
              0,
              0,
              0
            ],
            "littleDip": [
              0,
              0,
              0
            ]
          }
        }
      }
    }
  ]
} as const satisfies MotionDefinition;

export const typedProfile = {
  "schemaVersion": "0.1.0",
  "id": "vrm1-humanoid.default",
  "rig": "vrm-humanoid",
  "capability": "full",
  "bones": {
    "left": {
      "wrist": "leftHand",
      "shoulder": "leftUpperArm",
      "elbow": "leftLowerArm",
      "fingers": {
        "thumbCmc": "leftThumbMetacarpal",
        "thumbMcp": "leftThumbProximal",
        "thumbIp": "leftThumbDistal",
        "indexMcp": "leftIndexProximal",
        "indexPip": "leftIndexIntermediate",
        "indexDip": "leftIndexDistal",
        "middleMcp": "leftMiddleProximal",
        "middlePip": "leftMiddleIntermediate",
        "middleDip": "leftMiddleDistal",
        "ringMcp": "leftRingProximal",
        "ringPip": "leftRingIntermediate",
        "ringDip": "leftRingDistal",
        "littleMcp": "leftLittleProximal",
        "littlePip": "leftLittleIntermediate",
        "littleDip": "leftLittleDistal"
      }
    },
    "right": {
      "wrist": "rightHand",
      "shoulder": "rightUpperArm",
      "elbow": "rightLowerArm",
      "fingers": {
        "thumbCmc": "rightThumbMetacarpal",
        "thumbMcp": "rightThumbProximal",
        "thumbIp": "rightThumbDistal",
        "indexMcp": "rightIndexProximal",
        "indexPip": "rightIndexIntermediate",
        "indexDip": "rightIndexDistal",
        "middleMcp": "rightMiddleProximal",
        "middlePip": "rightMiddleIntermediate",
        "middleDip": "rightMiddleDistal",
        "ringMcp": "rightRingProximal",
        "ringPip": "rightRingIntermediate",
        "ringDip": "rightRingDistal",
        "littleMcp": "rightLittleProximal",
        "littlePip": "rightLittleIntermediate",
        "littleDip": "rightLittleDistal"
      }
    },
    "face": {
      "head": "head",
      "jaw": "jaw"
    }
  },
  "rangeOfMotion": {
    "wrist": {
      "x": [
        -70,
        70
      ],
      "y": [
        -90,
        90
      ],
      "z": [
        -30,
        30
      ]
    },
    "elbow": {
      "x": [
        0,
        145
      ]
    },
    "shoulder": {
      "x": [
        -90,
        90
      ],
      "y": [
        -90,
        90
      ],
      "z": [
        -90,
        90
      ]
    },
    "thumbCmc": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "thumbMcp": {
      "x": [
        -20,
        90
      ],
      "z": [
        -15,
        15
      ]
    },
    "thumbIp": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "indexMcp": {
      "x": [
        -20,
        90
      ],
      "z": [
        -15,
        15
      ]
    },
    "indexPip": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "indexDip": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "middleMcp": {
      "x": [
        -20,
        90
      ],
      "z": [
        -15,
        15
      ]
    },
    "middlePip": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "middleDip": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "ringMcp": {
      "x": [
        -20,
        90
      ],
      "z": [
        -15,
        15
      ]
    },
    "ringPip": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "ringDip": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "littleMcp": {
      "x": [
        -20,
        90
      ],
      "z": [
        -15,
        15
      ]
    },
    "littlePip": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    },
    "littleDip": {
      "x": [
        0,
        100
      ],
      "z": [
        -15,
        15
      ]
    }
  },
  "restPoseCorrection": {
    "leftUpperArm": [
      0,
      0,
      -60
    ],
    "rightUpperArm": [
      0,
      0,
      60
    ]
  }
} as const satisfies AvatarProfile;
