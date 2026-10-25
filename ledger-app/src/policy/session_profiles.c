/*******************************************************************************
 *   carbs: session profiles (see session_profiles.h).
 ********************************************************************************/

#include "session_profiles.h"

#include <string.h>

#define DROPS_PER_XRP  1000000ULL
#define CENTI_XRP      (DROPS_PER_XRP / 100)
#define DECI_XRP       (DROPS_PER_XRP / 10)
#define SECONDS_PER_MN 60U

// PermissionValue = transaction type + 1
#define PERMISSION_OFFER_CREATE 8
#define PERMISSION_OFFER_CANCEL 9
#define PERMISSION_NFTOKEN_MINT 26

// Presets a tap on a limit cycles through; every default is one of them
static const uint64_t CAP_PRESETS[] = {
    1 * DROPS_PER_XRP,
    2 * DROPS_PER_XRP,
    5 * DROPS_PER_XRP,
    10 * DROPS_PER_XRP,
    20 * DROPS_PER_XRP,
    50 * DROPS_PER_XRP,
    100 * DROPS_PER_XRP,
};
static const uint64_t PER_TX_PRESETS[] = {
    1 * CENTI_XRP,
    1 * DECI_XRP,
    1 * DROPS_PER_XRP,
    5 * DROPS_PER_XRP,
    10 * DROPS_PER_XRP,
};
static const uint64_t DURATION_PRESETS[] = {
    1 * SECONDS_PER_MN,
    3 * SECONDS_PER_MN,
    5 * SECONDS_PER_MN,
    10 * SECONDS_PER_MN,
};
static const uint64_t TX_COUNT_PRESETS[] = {10, 20, 50, 100, 200, 500, 1000};
#define PRESETS_NB(presets) (sizeof(presets) / sizeof(presets[0]))

typedef struct {
    uint8_t modes;
    uint8_t permissions_nb;
    uint32_t permissions[SESSION_PROFILE_MAX_PERMISSIONS];
    uint64_t defaults[SESSION_PROFILE_LIMITS_NB];  // indexed by session_profile_limit_t
} profile_definition_t;

static const profile_definition_t PROFILES[SESSION_PROFILES_NB] = {
    [SESSION_PROFILE_AGENT] = {.modes = SESSION_MODE_CAP,
                               .defaults = {50 * DROPS_PER_XRP,
                                            5 * DROPS_PER_XRP,
                                            3 * SECONDS_PER_MN,
                                            20}},
    [SESSION_PROFILE_GAME] = {.modes = SESSION_MODE_CAP,
                              .defaults = {5 * DROPS_PER_XRP,
                                           1 * DECI_XRP,
                                           10 * SECONDS_PER_MN,
                                           500}},
    [SESSION_PROFILE_TRADING] = {.modes = SESSION_MODE_PERMISSIONS,
                                 .permissions_nb = 2,
                                 .permissions = {PERMISSION_OFFER_CREATE, PERMISSION_OFFER_CANCEL},
                                 .defaults = {0, 0, 10 * SECONDS_PER_MN, 200}},
    [SESSION_PROFILE_STREAMING] = {.modes = SESSION_MODE_CAP,
                                   .defaults = {2 * DROPS_PER_XRP,
                                                1 * CENTI_XRP,
                                                10 * SECONDS_PER_MN,
                                                1000}},
    [SESSION_PROFILE_MINTING] = {.modes = SESSION_MODE_PERMISSIONS,
                                 .permissions_nb = 1,
                                 .permissions = {PERMISSION_NFTOKEN_MINT},
                                 .defaults = {0, 0, 10 * SECONDS_PER_MN, 100}},
};

// The name a MemoData carries; a switch rather than a table of pointers,
// which would need PIC() on the device
static const char *memo_name(session_profile_id_t id) {
    switch (id) {
        case SESSION_PROFILE_AGENT:
            return "agent";
        case SESSION_PROFILE_GAME:
            return "game";
        case SESSION_PROFILE_TRADING:
            return "trading";
        case SESSION_PROFILE_STREAMING:
            return "streaming";
        case SESSION_PROFILE_MINTING:
            return "minting";
        default:
            return NULL;
    }
}

const char *session_profile_title(session_profile_id_t id) {
    switch (id) {
        case SESSION_PROFILE_AGENT:
            return "Agent";
        case SESSION_PROFILE_GAME:
            return "Game";
        case SESSION_PROFILE_TRADING:
            return "Trading";
        case SESSION_PROFILE_STREAMING:
            return "Streaming";
        case SESSION_PROFILE_MINTING:
            return "Minting";
        default:
            return "";
    }
}

bool session_profile_from_memo(const uint8_t *data, size_t length, session_profile_id_t *id) {
    for (int i = 0; i < SESSION_PROFILES_NB; i++) {
        const char *name = memo_name((session_profile_id_t) i);
        if (length == strlen(name) && memcmp(data, name, length) == 0) {
            *id = (session_profile_id_t) i;
            return true;
        }
    }
    return false;
}

static bool is_memo_field(const field_t *field, uint8_t id) {
    return field->data_type == STI_VL && field->id == id &&
           field->array_info.type == XRP_STARRAY_MEMOS;
}

static bool is_profile_memo_type(const field_t *field) {
    size_t length = sizeof(SESSION_PROFILE_MEMO_TYPE) - 1;
    return is_memo_field(field, XRP_VL_MEMO_TYPE) && field->length == length &&
           memcmp(field->data.ptr, SESSION_PROFILE_MEMO_TYPE, length) == 0;
}

// The MemoData of the same Memo as memo_type, or NULL
static const field_t *find_memo_data(const parseResult_t *result, const field_t *memo_type) {
    for (uint8_t i = 0; i < result->num_fields; i++) {
        const field_t *field = &result->fields[i];
        if (is_memo_field(field, XRP_VL_MEMO_DATA) &&
            field->array_info.index1 == memo_type->array_info.index1) {
            return field;
        }
    }
    return NULL;
}

session_profile_memo_t session_profile_read_memo(const parseResult_t *result,
                                                 session_profile_id_t *id) {
    session_profile_memo_t memo = SESSION_PROFILE_MEMO_NONE;
    for (uint8_t i = 0; i < result->num_fields; i++) {
        const field_t *field = &result->fields[i];
        if (!is_profile_memo_type(field)) {
            continue;
        }
        if (memo != SESSION_PROFILE_MEMO_NONE) {
            return SESSION_PROFILE_MEMO_DUPLICATE;
        }
        const field_t *data = find_memo_data(result, field);
        memo = data != NULL && session_profile_from_memo(data->data.ptr, data->length, id)
                   ? SESSION_PROFILE_MEMO_FOUND
                   : SESSION_PROFILE_MEMO_UNKNOWN;
    }
    return memo;
}

static const uint64_t *presets_of(session_profile_limit_t limit, size_t *presets_nb) {
    switch (limit) {
        case SESSION_PROFILE_LIMIT_CAP:
            *presets_nb = PRESETS_NB(CAP_PRESETS);
            return CAP_PRESETS;
        case SESSION_PROFILE_LIMIT_PER_TX:
            *presets_nb = PRESETS_NB(PER_TX_PRESETS);
            return PER_TX_PRESETS;
        case SESSION_PROFILE_LIMIT_DURATION:
            *presets_nb = PRESETS_NB(DURATION_PRESETS);
            return DURATION_PRESETS;
        default:
            *presets_nb = PRESETS_NB(TX_COUNT_PRESETS);
            return TX_COUNT_PRESETS;
    }
}

bool session_profile_has_limit(session_profile_id_t id, session_profile_limit_t limit) {
    if (limit == SESSION_PROFILE_LIMIT_CAP || limit == SESSION_PROFILE_LIMIT_PER_TX) {
        return (PROFILES[id].modes & SESSION_MODE_CAP) != 0;
    }
    return true;
}

// The value of a stored setting: a preset, or the default (0, or an index
// no preset has)
static uint64_t limit_value(session_profile_id_t id,
                            session_profile_limit_t limit,
                            uint8_t setting) {
    if (!session_profile_has_limit(id, limit)) {
        return 0;
    }
    size_t presets_nb;
    const uint64_t *presets = presets_of(limit, &presets_nb);
    if (setting == 0 || setting > presets_nb) {
        return PROFILES[id].defaults[limit];
    }
    return presets[setting - 1];
}

uint8_t session_profile_next_limit(session_profile_id_t id,
                                   session_profile_limit_t limit,
                                   uint8_t setting) {
    size_t presets_nb;
    const uint64_t *presets = presets_of(limit, &presets_nb);
    uint64_t current = limit_value(id, limit, setting);
    for (size_t i = 0; i < presets_nb; i++) {
        if (presets[i] == current) {
            return (uint8_t) ((i + 1) % presets_nb + 1);
        }
    }
    return 1;
}

void session_profile_resolve(session_profile_id_t id,
                             const session_profile_settings_t *settings,
                             session_profile_t *profile) {
    const profile_definition_t *definition = &PROFILES[id];

    memset(profile, 0, sizeof(*profile));
    profile->enabled = settings->disabled == 0;
    profile->modes = definition->modes;
    profile->permissions_nb = definition->permissions_nb;
    memcpy(profile->permissions, definition->permissions, sizeof(profile->permissions));
    profile->max_cap =
        limit_value(id, SESSION_PROFILE_LIMIT_CAP, settings->limits[SESSION_PROFILE_LIMIT_CAP]);
    profile->max_per_tx = limit_value(id,
                                      SESSION_PROFILE_LIMIT_PER_TX,
                                      settings->limits[SESSION_PROFILE_LIMIT_PER_TX]);
    profile->max_duration = (uint32_t) limit_value(id,
                                                   SESSION_PROFILE_LIMIT_DURATION,
                                                   settings->limits[SESSION_PROFILE_LIMIT_DURATION]);
    profile->max_tx_count = (uint32_t) limit_value(id,
                                                   SESSION_PROFILE_LIMIT_TX_COUNT,
                                                   settings->limits[SESSION_PROFILE_LIMIT_TX_COUNT]);
}
