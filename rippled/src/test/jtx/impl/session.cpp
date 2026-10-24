#include <test/jtx/session.h>

#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/JTx.h>

#include <xrpl/json/json_value.h>
#include <xrpl/json/to_string.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/jss.h>

#include <cstdint>
#include <optional>

namespace xrpl::test::jtx::session {

json::Value
set(jtx::Account const& account, jtx::Account const& sessionKey, std::uint32_t duration)
{
    json::Value jv;
    jv[jss::TransactionType] = jss::SigningSessionSet;
    jv[jss::Account] = account.human();
    jv[sfSessionKey.jsonName] = sessionKey.human();
    jv[sfSessionDuration.jsonName] = duration;
    return jv;
}

json::Value
del(jtx::Account const& account,
    jtx::Account const& sessionKey,
    std::optional<jtx::Account> const& owner)
{
    json::Value jv;
    jv[jss::TransactionType] = jss::SigningSessionDelete;
    jv[jss::Account] = account.human();
    jv[sfSessionKey.jsonName] = sessionKey.human();
    if (owner)
        jv[sfOwner.jsonName] = owner->human();
    return jv;
}

json::Value
entry(jtx::Env& env, jtx::Account const& account, jtx::Account const& sessionKey)
{
    json::Value jvParams;
    jvParams[jss::ledger_index] = jss::validated;
    jvParams[jss::signing_session][jss::account] = account.human();
    jvParams[jss::signing_session][jss::session_key] = sessionKey.human();
    return env.rpc("json", "ledger_entry", to_string(jvParams));
}

void
Cap::operator()(Env&, JTx& jt) const
{
    jt.jv[sfSessionCap.jsonName] = cap_.getJson(JsonOptions::Values::None);
}

void
Permissions::operator()(Env&, JTx& jt) const
{
    json::Value permissionsJson(json::ValueType::Array);
    for (auto const& permission : permissions_)
    {
        json::Value permissionValue;
        permissionValue[sfPermissionValue.jsonName] = permission;
        json::Value permissionObj;
        permissionObj[sfPermission.jsonName] = permissionValue;
        permissionsJson.append(permissionObj);
    }
    jt.jv[sfPermissions.jsonName] = permissionsJson;
}

}  // namespace xrpl::test::jtx::session
