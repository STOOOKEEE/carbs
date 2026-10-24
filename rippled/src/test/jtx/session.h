#pragma once

#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/JTx.h>

#include <xrpl/json/json_value.h>
#include <xrpl/protocol/STAmount.h>

#include <cstdint>
#include <optional>
#include <string>
#include <utility>
#include <vector>

/**
 * Helpers for the SigningSessions amendment: build SigningSessionSet and
 * SigningSessionDelete, and read a session entry.
 */
namespace xrpl::test::jtx::session {

/**
 * A SigningSessionSet without a mode. Add one with Txflags(tfAllTransactions),
 * Cap or Permissions.
 */
json::Value
set(jtx::Account const& account, jtx::Account const& sessionKey, std::uint32_t duration);

/**
 * A SigningSessionDelete. Without owner, the session belongs to account.
 */
json::Value
del(jtx::Account const& account,
    jtx::Account const& sessionKey,
    std::optional<jtx::Account> const& owner = std::nullopt);

/**
 * The ledger_entry answer for the session of (account, sessionKey).
 */
json::Value
entry(jtx::Env& env, jtx::Account const& account, jtx::Account const& sessionKey);

/**
 * Mode C: the total the session may spend, fees included.
 */
class Cap
{
private:
    STAmount cap_;

public:
    explicit Cap(STAmount const& cap) : cap_(cap)
    {
    }

    void
    operator()(Env&, JTx& jt) const;
};

/**
 * Mode P: XLS-75 permission names, written as DelegateSet takes them.
 */
class Permissions
{
private:
    std::vector<std::string> permissions_;

public:
    explicit Permissions(std::vector<std::string> permissions)
        : permissions_(std::move(permissions))
    {
    }

    void
    operator()(Env&, JTx& jt) const;
};

}  // namespace xrpl::test::jtx::session
