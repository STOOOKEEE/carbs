#include <test/jtx/Account.h>
#include <test/jtx/Env.h>
#include <test/jtx/JTx.h>
#include <test/jtx/amount.h>
#include <test/jtx/batch.h>
#include <test/jtx/delegate.h>
#include <test/jtx/envconfig.h>
#include <test/jtx/fee.h>
#include <test/jtx/flags.h>
#include <test/jtx/last_ledger_sequence.h>
#include <test/jtx/pay.h>
#include <test/jtx/regkey.h>
#include <test/jtx/rpc.h>
#include <test/jtx/seq.h>
#include <test/jtx/session.h>
#include <test/jtx/sig.h>
#include <test/jtx/sponsor.h>
#include <test/jtx/ter.h>
#include <test/jtx/txflags.h>
#include <test/jtx/utility.h>
#include <test/jtx/webauthn.h>

#include <xrpld/app/misc/Transaction.h>

#include <xrpl/basics/Blob.h>
#include <xrpl/basics/StringUtilities.h>
#include <xrpl/basics/strHex.h>
#include <xrpl/beast/unit_test/suite.h>
#include <xrpl/core/HashRouter.h>
#include <xrpl/json/json_value.h>
#include <xrpl/protocol/AccountID.h>
#include <xrpl/protocol/Feature.h>
#include <xrpl/protocol/Indexes.h>
#include <xrpl/protocol/KeyType.h>
#include <xrpl/protocol/SField.h>
#include <xrpl/protocol/STTx.h>
#include <xrpl/protocol/TER.h>
#include <xrpl/protocol/TxFlags.h>
#include <xrpl/protocol/jss.h>
#include <xrpl/server/NetworkOPs.h>
#include <xrpl/tx/apply.h>

#include <memory>
#include <string>
#include <utility>

namespace xrpl {

namespace {

// A WebAuthn assertion made outside rippled, by the generator
// packages/core/spikes/passkey-mldsa-vector.ts: an ML-DSA-44 key from a fixed
// seed and a pure ML-DSA-44 signature (empty context) by @noble/post-quantum
// 0.7.1, over the signing data that ripple-binary-codec 2.11.0 encodes for
// kVectorTx. The node must verify it as it is.
namespace vector {

// publicKey, 1312 bytes.
constexpr char const* kPublicKey =
    "FFFCFAD49022897E71F4041D61CD8CD58F321118ECF61548A407C2EBE22589EBC2C6ED5BAD0982AC"
    "A712E70C0F7E19D18518487E27F4FFFB71948A5B7D3FC94C05774DA7C7EF6494D63B2D59179563F0"
    "6EF56276C977FACB5A8609D04E7176F1AF2DE964B58E693B0313281632A7C21278357DC8D12B9A59"
    "082C6F54E59397869D7A5F1EE63D4DD25644530163B3C1961BAEEEEE2D5F8E2EDD7367AD49E290FA"
    "61CE71007465BE3B332FB3CF6A70CCC98213B21FFFB97D5D2BDA24C3189303C09F756CEA7D65C7B1"
    "C9820A0AD58F184D8FDF6154D74AA62FED5BE2FFD79E1B94697B30F85504D07CF12017A28B896F35"
    "95C1838625B3E39F331556B1548153A92E015B6195C6639096A65FD82EFFE199E4D5414EEB17EC66"
    "77CCCA2D2E3B4FA6F856828EB07F7E16234694D6341E28404276DC11602E25B4B6FFC3FB2CFE4E17"
    "194C3C04A602CB49662E471F434B6B6782FB9830675E2A7E9E97067462466BCDE4F31A6A4945C084"
    "CC28AB66086BF92FC9A6839BAB3197BDA74C59353971E083425884CC38603161F092BCEB7188776F"
    "6151CBEE0B2D292844594011D48A3615C34D77F36D664F4E19C318290A17186C01EEC4AC662F84E9"
    "879624CADBA9256669C46029966D9D1FC6AD5AC526C0901D42379363C259A429C488D599500F93FF"
    "49ABC00CF6AD3010CB622DC43B1F6DCFD066A43777F1667EAB4CBF341DB01380F7471314013BA8B3"
    "0780EE222E3DDB723FE8D989D3B8366097704FDD68B0C685E2AAEC7CDEE43123B755549999397576"
    "A05F405023E75055758EB779889B0186766C81BD38C7F08F09871E9ED1726BE0BDCB74E5AFCF2F02"
    "4783C19EA58BFEB4B38BFDE09DB657F4C205285C654B72905637BEAEF08763E511AE523AEE9FD3F5"
    "7E46A8D6AA40A6866C8871E9E97D8CBABBF37E9D2D958C57E564FAE684ACACCF24D69DD372F18435"
    "894799CB2786736E9012120972E7D1F6B70F59C29351DDC34DFFF65EC93E9A8B03F09704254A06E8"
    "13AD2F0FC61AC911213B2D260AC103973C214DE5E54BA449B9A763265DFE0109C57B835173FBCBA8"
    "A2137D1A2A978FDE1A488273B7B377889D2DBD4D6C746194B447B92183C514FA22581CC3AE733056"
    "12A0AB82895B3A05B15506F458B53EFD5981D4130B0A531C539A2C3C6DFA3B0AFF27267602536860"
    "5622A8FDB251332EAAD3AE84F7B37B2AA83DC37D73F1FEBC0F0EF7376E712E9544ADDCC85540BA24"
    "1461BF9ED82706C6E77C101F336490907BA65C179A47B2269C8FBB63C4469887CEC6FEA2AC4DD119"
    "B0DD5DFBEAE3292377ED044A92BAFB30CB0C4257444103A900FF51DC5BB3A1BFF9C24C44B96B02BA"
    "B891FA446EB20B471AE7578FA36EB13B4D848ABD96EE6FBE9A2D7F6B37100AE51AF2DDA031BBC125"
    "DECCEABF14CC4D526576B5C65ECEA8B9F7CD07350B09E91B6B72B629F357CD4D3BBC148B6FC51176"
    "97C0D868E744BF3FAB446141CEEA899AB1625E78449DDD32D25A473CC66E82EB9DAEB2F7177F1574"
    "1FBF62625A71FEBAB6FDDB3B430941CDD8916CE623FCB8534C9A494E1F5B52917988931D8FAB19D7"
    "2D65F4219B70A962E430DD33557C78A96351D2952441A62CA6695F881C11CF0DE71FBB39C70D6A4B"
    "49FD60DEC38E77FA6AA4AF8706A96B8FAE529F54DCE956EA960F2456B8B28B4F07EF5586C4A9D124"
    "DAD3E3782936ECACCA9A36DE0BA4E17984A02B3F518643EC90495A65B8971D560126AAE02FEDF9BE"
    "3A6DCA3A35B72D6640EDEF3408D4A31736FB0CADF98A8B6A4816036501E881A84F1653044FE59582"
    "6B6A945E199C8FDD5AECF8F45A546FDC011FD0879803E845BBECCB2F395A6B4E";

// signingData, 1394 bytes.
constexpr char const* kSigningData =
    "53545800120000220000000024000000016140000000000F424068400000000000000A73C55FFFFC"
    "FAD49022897E71F4041D61CD8CD58F321118ECF61548A407C2EBE22589EBC2C6ED5BAD0982ACA712"
    "E70C0F7E19D18518487E27F4FFFB71948A5B7D3FC94C05774DA7C7EF6494D63B2D59179563F06EF5"
    "6276C977FACB5A8609D04E7176F1AF2DE964B58E693B0313281632A7C21278357DC8D12B9A59082C"
    "6F54E59397869D7A5F1EE63D4DD25644530163B3C1961BAEEEEE2D5F8E2EDD7367AD49E290FA61CE"
    "71007465BE3B332FB3CF6A70CCC98213B21FFFB97D5D2BDA24C3189303C09F756CEA7D65C7B1C982"
    "0A0AD58F184D8FDF6154D74AA62FED5BE2FFD79E1B94697B30F85504D07CF12017A28B896F3595C1"
    "838625B3E39F331556B1548153A92E015B6195C6639096A65FD82EFFE199E4D5414EEB17EC6677CC"
    "CA2D2E3B4FA6F856828EB07F7E16234694D6341E28404276DC11602E25B4B6FFC3FB2CFE4E17194C"
    "3C04A602CB49662E471F434B6B6782FB9830675E2A7E9E97067462466BCDE4F31A6A4945C084CC28"
    "AB66086BF92FC9A6839BAB3197BDA74C59353971E083425884CC38603161F092BCEB7188776F6151"
    "CBEE0B2D292844594011D48A3615C34D77F36D664F4E19C318290A17186C01EEC4AC662F84E98796"
    "24CADBA9256669C46029966D9D1FC6AD5AC526C0901D42379363C259A429C488D599500F93FF49AB"
    "C00CF6AD3010CB622DC43B1F6DCFD066A43777F1667EAB4CBF341DB01380F7471314013BA8B30780"
    "EE222E3DDB723FE8D989D3B8366097704FDD68B0C685E2AAEC7CDEE43123B755549999397576A05F"
    "405023E75055758EB779889B0186766C81BD38C7F08F09871E9ED1726BE0BDCB74E5AFCF2F024783"
    "C19EA58BFEB4B38BFDE09DB657F4C205285C654B72905637BEAEF08763E511AE523AEE9FD3F57E46"
    "A8D6AA40A6866C8871E9E97D8CBABBF37E9D2D958C57E564FAE684ACACCF24D69DD372F184358947"
    "99CB2786736E9012120972E7D1F6B70F59C29351DDC34DFFF65EC93E9A8B03F09704254A06E813AD"
    "2F0FC61AC911213B2D260AC103973C214DE5E54BA449B9A763265DFE0109C57B835173FBCBA8A213"
    "7D1A2A978FDE1A488273B7B377889D2DBD4D6C746194B447B92183C514FA22581CC3AE73305612A0"
    "AB82895B3A05B15506F458B53EFD5981D4130B0A531C539A2C3C6DFA3B0AFF272676025368605622"
    "A8FDB251332EAAD3AE84F7B37B2AA83DC37D73F1FEBC0F0EF7376E712E9544ADDCC85540BA241461"
    "BF9ED82706C6E77C101F336490907BA65C179A47B2269C8FBB63C4469887CEC6FEA2AC4DD119B0DD"
    "5DFBEAE3292377ED044A92BAFB30CB0C4257444103A900FF51DC5BB3A1BFF9C24C44B96B02BAB891"
    "FA446EB20B471AE7578FA36EB13B4D848ABD96EE6FBE9A2D7F6B37100AE51AF2DDA031BBC125DECC"
    "EABF14CC4D526576B5C65ECEA8B9F7CD07350B09E91B6B72B629F357CD4D3BBC148B6FC5117697C0"
    "D868E744BF3FAB446141CEEA899AB1625E78449DDD32D25A473CC66E82EB9DAEB2F7177F15741FBF"
    "62625A71FEBAB6FDDB3B430941CDD8916CE623FCB8534C9A494E1F5B52917988931D8FAB19D72D65"
    "F4219B70A962E430DD33557C78A96351D2952441A62CA6695F881C11CF0DE71FBB39C70D6A4B49FD"
    "60DEC38E77FA6AA4AF8706A96B8FAE529F54DCE956EA960F2456B8B28B4F07EF5586C4A9D124DAD3"
    "E3782936ECACCA9A36DE0BA4E17984A02B3F518643EC90495A65B8971D560126AAE02FEDF9BE3A6D"
    "CA3A35B72D6640EDEF3408D4A31736FB0CADF98A8B6A4816036501E881A84F1653044FE595826B6A"
    "945E199C8FDD5AECF8F45A546FDC011FD0879803E845BBECCB2F395A6B4E8114B5F762798A53D543"
    "A014CAF8B297CFF8F2F937E88314F51DFC2A09D62CBBA1DFBDD4691DAC96AD98B90F";

// authenticatorData, 37 bytes.
constexpr char const* kAuthenticatorData =
    "A2BF9F56D790620DE28F2A0251FC4335715027C9C4F10C6F5C0AA8AE5475FB5B0500000007";

// clientDataJSON, 1950 bytes.
constexpr char const* kClientDataJSON =
    "7B2274797065223A22776562617574686E2E676574222C226368616C6C656E6765223A2255315259"
    "4142494141434941414141414A414141414146685141414141414150516B426F5141414141414141"
    "4141707A78565F5F5F5072556B434B4A666E4830424231687A597A566A7A4952474F7A324655696B"
    "42384C723469574A36384C473756757443594B7370784C6E4441392D476447464745682D4A5F545F"
    "2D334755696C743950386C4D4258644E703866765A4A54574F79315A4635566A38473731596E624A"
    "645F724C576F594A30453578647647764C656C6B745935704F774D544B4259797038495365445639"
    "794E45726D6C6B494C473955355A4F58687031365878376D50553353566B525441574F7A775A5962"
    "727537754C562D4F4C74317A5A36314A34704436596335784148526C766A737A4C375050616E444D"
    "7959495473685F5F755831644B396F6B777869544138436664577A716657584873636D4343677256"
    "6A78684E6A393968564E644B70695F74572D4C5F313534626C476C374D506856424E423838534158"
    "6F6F754A627A575677594F474A62506A6E7A4D565672465567564F704C674662595A584759354357"
    "706C5F594C765F686D65545651553772462D786D64387A4B4C53343754366234566F4B4F7348392D"
    "46694E476C4E593048696841516E6263455741754A6253325F3850374C50354F46786C4D5041536D"
    "4173744A5A69354848304E4C613265432D3567775A31347166703658426E5269526D764E35504D61"
    "616B6C467749544D4B4B746D434776354C386D6D673575724D5A65397030785A4E546C7834494E43"
    "5749544D4F47417859664353764F7478694864765956484C376773744B5368455755415231496F32"
    "46634E4E645F4E745A6B394F47634D594B516F5847477742377353735A692D45365965574A4D7262"
    "7153566D616352674B5A5A746E525F47725672464A734351485549336B3250435761517078496A56"
    "6D5641506B5F394A7138414D39713077454D74694C635137483233503047616B4E3366785A6E3672"
    "544C38304862415467506448457851424F36697A42344475496934393233495F364E6D4A30376732"
    "594A64775439316F734D614634717273664E376B4D534F335656535A6D546C31647142665146416A"
    "35314256645936336559696241595A32624947394F4D66776A776D4848703752636D766776637430"
    "35615F504C774A48673847657059762D744C4F4C5F654364746C66307767556F5847564C63704257"
    "4E3736753849646A35524775556A72756E395031666B616F31717041706F5A73694848703658324D"
    "7572767A667030746C59785835575436356F5373724D386B31703354637647454E596C486D63736E"
    "686E4E756B42495343584C6E3066613344316E436B3148647730335F396C374A5070714C415F4358"
    "4243564B42756754725338507868724A455345374C53594B77514F585043464E3565564C70456D35"
    "70324D6D58663442436356376731467A2D38756F6F684E39476971586A39346153494A7A74374E33"
    "694A30747655317364474755744565354959504646506F6957427A44726E4D7756684B6771344B4A"
    "577A6F4673565547394669315076315A676451544377705448464F614C4478742D6A734B5F79636D"
    "64674A546147425749716A39736C457A4C717254726F54337333737171443344665850785F727750"
    "44766333626E45756C555374334D6856514C6F6B4647475F6E74676E4273626E664241664D325351"
    "6B48756D584265615237496D6E492D37593852476D49664F78763669724533524762446458667671"
    "34796B6A642D304553704B362D7A444C44454A58524545447151445F556478627336475F2D634A4D"
    "524C6C72417271346B6670456272494C5278726E56342D6A627245375459534B765A627562373661"
    "4C5839724E78414B35527279336141787538456C33737A717678544D54564A6C647258475873366F"
    "7566664E427A554C43656B6261334B324B664E587A5530377642534C623855526470664132476A6E"
    "524C385F7130526851633771695A7178596C3534524A33644D744A61527A7A47626F4C726E613679"
    "3978645F4658516676324A69576E482D75726239327A74444355484E324A46733569503875464E4D"
    "6D6B6C4F483174536B586D496B78325071786E584C575830495A747771574C6B4D4E307A56587834"
    "71574E523070556B51615973706D6C66694277527A77336E483773357877317153306E39594E3744"
    "6A6E6636617153766877617061342D7555703955334F6C57367059504A466134736F7450422D3956"
    "6873537030535461302D4E344B546273724D71614E74344C704F4635684B417250314747512D7951"
    "5356706C754A63645667456D7175417637666D2D4F6D334B4F6A57334C575A4137653830434E536A"
    "467A6237444B3335696F7471534259445A51486F67616850466C4D45542D5756676D74716C46345A"
    "6E495F6457757A343946705562397742483943486D41506F5262767379793835576D744F67525331"
    "39324A35696C505651364155797669796C385F3438766B3336494D55395233384B676E574C4C7568"
    "33373355615232736C713259755138222C226F726967696E223A2268747470733A2F2F6361726273"
    "2E6578616D706C65222C2263726F73734F726967696E223A66616C73657D";

// signature, 2420 bytes.
constexpr char const* kSignature =
    "2008C7723A2AB1378DD60C7E7244A93FDF3D53BECB147C06C17BBD39A5C2B479BF0657E1387872AA"
    "BE1233755D9772EAC97AC8CF8021B28BCF281E8EBD405C3A38BB0058117F4A6CC6C648D08C028840"
    "A4F7FD5441E0AA13BD0AA5F422FF636ED8BDB502508D1051A0BF30F826C6CBF67B49E8DAB2F1567B"
    "AD498BABDB926360094BD74FB2AC5036A4A6C8FD1B9742A63EA7E5C28A43F2295509E4388327D56D"
    "8E5049C9E814AB99716DEC61E39C2F6D5E13C2D11CDF9B0E51F4CDC615B19DC473310B430B220380"
    "82E4B4C7517DA5E2F94DBD01763F92D9A1CFB1B9676DEDC9E4496A207DFF7354165BEC30611E613B"
    "0BBD655C91AAE7BA6F0C85A4AAC51FC3DDC022A0F7BBAE154C4E8A170E6ED7E7418506CA53B75798"
    "35B2BCFFCFF8C9BFAC15A7DCD966B3AE19D5047EED78938CB598745568AB240300BB71A0C62745C7"
    "13F37ABE086F08C9B67478A49F5B7303B5B5775A455263890181376E15F1F8C0C40E300403285284"
    "737ECF0F8A4B74D55CD61294C60CD92450CDFA2E37876EA6CFE6804242FF5DC462E24CBCB6FA16FA"
    "0B6F11B8200B7E666E0C09CB0445CCECE04607101F84574E5AA173A0B025597DDE524478C8432BFD"
    "3A5BC8900F3455FC6A6346C5D2A5A8B94BEF3E17C7AA084E461DEBC3BC74151896BEFED609C07196"
    "E67ACC70126BD27D846CBEF9432D8015E1C7CB3EBA12DDCDEC9418BBEA6C03134158474E7DE33A7A"
    "A7292CC3BC8B7A97CFC6676C7518C28A2B5A0E5862687192CA1EDAA42E5478657BA6C71918DE5BF2"
    "81CC756DA9B800149B60F1965FDACF15B2A775C1C8E0795EF883266BD5E889C273087CF3E6E3974A"
    "ACEDFC431A7681663934169A826EC0650AF84756C4CF185B6BB8A4AFCE07CB15335B196973CB8E76"
    "BB6D44C6ACC9382E83C3870790E52F8C1809E48ED89A9B0C88E87846532CC7AE7D5C69B4BBC6009C"
    "20530E9B37522E7E41259E71AC17649BA81FDDAD119355ECD7E71813A67F6C2681552E7824BC5390"
    "87E558EEC800E55244048DBA633216FBA598365BCD612A84C39C8FDD2D9340C119E70A5D270C89F5"
    "5B01AB063D3D36A6874740AA32042E1F3699EF888219084BA1140E8D83F6FE47B7E78D8171036D7E"
    "AE82AEC742CD52288F273001D1FF799947AD913315E1E0D08BCAC7672BFEB23E069447F18F22EB7C"
    "1931E188CB533844A8B8BD0DE496FD8D3041B76A1F3E9491601A01BEDAF80CA4BC4140B77E9A4A5E"
    "5784AAEE879C56BB7DB79D38E77D914F8F31EC52420E2A96EDE2361F056BC59C15570C115869855E"
    "F2BBDBF3F6B78E94EA8B0D7693C50D83C86A0BAE5919E24EB3CB76F666B2EEB73C6905021E15B8B9"
    "7AE945ADC123E5E82547C1925EE551210A2DAE08CEFF8D6A9E48B17B3DF0DF8E87CBACCD7695BDEA"
    "03ED739ACB9851AAAFBC121D9BF63279C3E3CD54FC4BDD702B770EE225868B5C02F6F84B006C965F"
    "4A61EACF88C5C5B7D2E723F02764CEF15E563F1A51241FB5DD7B6512A1EF8E3D29B3703BADBFE154"
    "1EC89D124FEEE20ADBAD15FD64B60249494A1A65F7133CDC1A2A9D7D37BB7FDA3A0E5620090CAEF6"
    "BD54A66B88FFB51B7752F4C7D792A68FE585435557A03E52B88B864D4DE0EB87526335EEE514C984"
    "D1307D613D89D9B86C3BAF85DF663F62F66C6E641B980744CC1413B0B75C3F2F773E12E7CF442FAE"
    "2428929055648FCD1E84D8772C6BCA806CC067842AAC8F3D520CE4F3BD5A2217379DF8BB5B3AFD26"
    "7643A2183DF117145B49EBB65760236EF760F101B1058F59FDDE3B128EBC5589B0867F0E22E25017"
    "3875E9327AE185F8B9F75F86E23FBC826478F04E5921BD220DD57FAC6DFAE4CB756B2553A6DA3375"
    "41F8E89650FA31997EEE2EF7F92E20C1914952E0BFC34450AABC22452867A66DAAD9CC4878865BD0"
    "430F433CA769C7DD819EA0F8214144255C6C430DDCB12D4B7D647ABC68AAC9F1F253FF5EBC7C97A7"
    "37E8280AB6A827EE1A91A8CA860ED20FE6643F51965AEA3CC4364D8994F3BCC4CFBDA10C010F9952"
    "C00EFCC4D60C413BF7AEAA52157812DA9B755C89CAE0A99972E5195C1A3F65272275E8E7AE32A780"
    "50079D46EC16ED095CB0E4B1DAA965C8FBCDF74A461BEEC18CE6E5588B26A97D8CEAFFDF13EF93F9"
    "812BEC28D71F83384DB463179BD737DC6316233D65C5FAAAE36133AB0B1373ED003996DD0A7D2416"
    "3760D260264F8841EC1999B17BAA78C1FD387DA71B43F78AFE24048A0C627D4F404A81123474CFF7"
    "A7CBA1C81F327D2695CD52B971E337904ED8D3EF53783A6359BD22657ADE56836B9B509A01CA3F73"
    "2BA9D74AE1ADE708E2C0CA17199636C9F03658540B85F27036D7DAB44602C7D0D999D6938448B134"
    "969D89E011E7E6783AC5553C210E754526EC1B82D45A43C48AF742E594D6B41D2BF85BD837E0F9DF"
    "06B23FA96FF0FDCCCC8A9A96A48A70EB2C3589DDFF408CD645ED46099372A10E96EFB9C5F0DC0B52"
    "9C43E0ED9C3787ACEF188AD787507A54AA85CD2A8EE64ED761C847977CF20281F377465F1D16C397"
    "775C687F3B6D6E8C50B82CAFEB000355760F04228CD2A15C9DE3863E70CC62D75D256AB1C8771DB6"
    "C6CA2A44E95BBE319F7551CE19D32643E6A97C27C91AC7050872939D088AED98AE194F5C8221F8C7"
    "99F5CC09B7920BEB7AB9F8CED6AF6557C31DE1A57DBC226F85022ECB204AC3EDC86C14E0CFFEE10D"
    "E290D198B6E7E89BF3102BD84BA09FAC7E324791587D3B90BEF42ECD4322AF90BA5E545951D6C910"
    "CEA52561B9CBFE486E94482D8276B0AF95684124153E0C4B6710D8672ADD85D94D7227429C490DC5"
    "27081CC999A232D762EF117A89A35E7DEE0BEBECFAF4E058EE1FA55C05AA2C618C4450D615D84B67"
    "998402DF1EFB3CD746B4292175161866D139CCB38B5C91D6D213FE423BBC61A1B3D0082022D7FF16"
    "9685DD01ED92F96A3A4A82DCCA6FC601197630957AC9A4AFA0D7D528DE1FF9DED7F58EFA2523D6C6"
    "80CE8015CFFEEFA77041D457728C51BD49AA2E3895C0D31ABE847F48C985233823D2E756567AA544"
    "025009B3B4256D856927C67D1C6E402235C43C0A7559840234FAF0AC7F4591F1FA3962E60AE3FD46"
    "A0E543209F5A6A1760E6A7F3A71B00D0AFF7F2B8B152AA7C2EBC8774658D40CE65343E374EB4047E"
    "8EA71A2F0352C1C0E3FDA82941C0F622592227F0531F5761161F804604A3D2226F49A39D807CDE85"
    "F7315F6D6C2E3614F627B3E3C932523E758202B65BA4F0F0C7706A41A7CF50972CD2ACC61C511F4F"
    "BE38BCF6FD8061E107766BEF3510E3B61A1B2B3B414253555C929CA0A6A9B8C5C9CDE1001E20333A"
    "7A7BA4C7C9E7F70753708297C6D2E3F6F912242E3D42456B94B70000000000000000000000000000"
    "00000000000000000000000000000000131F2932";

}  // namespace vector

}  // namespace

/**
 * PasskeyMLDSA: post-quantum passkeys. A passkey list may hold ML-DSA-44
 * public keys (1 312 bytes, no prefix), and a PasskeySignature made with an
 * ML-DSA-44 key (WebAuthn / COSE algorithm -48) is verified as a P-256 one is,
 * the signature over AuthenticatorData followed by the SHA-256 of
 * ClientDataJSON being pure ML-DSA-44 with an empty context. Results use the
 * software authenticator of test/jtx/webauthn.h: SIMULATED, no device and no
 * browser ceremony.
 */
class PasskeyMLDSA_test : public beast::unit_test::Suite
{
    static constexpr char const* kPasskeyId = "DEADBEEF";
    static constexpr char const* kOtherPasskeyId = "CAFE";

    // The answer of submit to a transaction whose signature does not verify,
    // on the first check of its ID (or on every check, when the verdict is
    // not kept).
    static test::jtx::Rpc
    invalidSignature()
    {
        return test::jtx::Rpc("invalidTransaction", "fails local checks: Invalid signature.");
    }

    static void
    expectRefused(test::jtx::JTx& jt)
    {
        jt.ter = telENV_RPC_FAILED;
        jt.rpcException = {"invalidTransaction", "fails local checks: Invalid signature."};
    }

    static void
    expectApplied(test::jtx::JTx& jt)
    {
        jt.ter = tesSUCCESS;
        jt.rpcException.reset();
    }

    // A copy of `jt` whose transaction is rebuilt from its edited JSON.
    template <class Edit>
    static test::jtx::JTx
    edited(test::jtx::JTx const& jt, Edit edit)
    {
        test::jtx::JTx copy = jt;
        edit(copy.jv);
        copy.stx = std::make_shared<STTx const>(test::jtx::parse(copy.jv));
        return copy;
    }

    // Fund alice and bob, and register `passkey` for alice.
    static void
    setUp(
        test::jtx::Env& env,
        test::jtx::Account const& alice,
        test::jtx::Account const& bob,
        test::jtx::Account const& passkey)
    {
        using namespace test::jtx;
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, passkey, kPasskeyId));
        env.close();
    }

    void
    testListSet(FeatureBitset features)
    {
        testcase("PasskeyListSet takes an ML-DSA-44 key only with the amendment");
        using namespace test::jtx;

        Account const pq{"pq", KeyType::Dilithium};
        Account const p256{"p256", KeyType::P256};
        BEAST_EXPECT(pq.pk().size() == 1312);

        // Without PasskeyMLDSA, or without one of the amendments it needs,
        // an ML-DSA-44 key is refused as before; a P-256 key is not.
        for (auto const& without : {featurePasskeyMLDSA, featureQuantum, fixP256StrictDer})
        {
            Env env{*this, envconfig(), features - without};
            Account const alice{"alice"};
            env.fund(XRP(1000), alice);
            env.close();
            env(passkeyListSet(alice, pq, kPasskeyId), Ter(temMALFORMED));
            env(passkeyListSet(alice, {{pq, kPasskeyId}, {p256, kOtherPasskeyId}}),
                Ter(temMALFORMED));
            env(passkeyListSet(alice, p256, kPasskeyId));
            env.close();
        }

        // With it, an ML-DSA-44 key is registered alone or next to a P-256
        // key, and stored as given.
        {
            Env env{*this, envconfig(), features};
            Account const alice{"alice"};
            Account const carol{"carol"};
            env.fund(XRP(1000), alice, carol);
            env.close();
            env(passkeyListSet(alice, pq, kPasskeyId));
            env(passkeyListSet(carol, {{p256, kPasskeyId}, {pq, kOtherPasskeyId}}));
            env.close();
            auto const list = env.le(keylet::passkeyList(alice.id()));
            if (BEAST_EXPECT(list))
            {
                auto const& passkeys = list->getFieldArray(sfPasskeys);
                BEAST_EXPECT(passkeys.size() == 1);
                BEAST_EXPECT(
                    passkeys[0].getFieldVL(sfPublicKey) ==
                    Blob(pq.pk().data(), pq.pk().data() + pq.pk().size()));
            }
            BEAST_EXPECT(env.le(keylet::passkeyList(carol.id())));

            // A value of another size is no key, whatever the amendment.
            Env env2{*this, envconfig(), features};
            Account const dave{"dave"};
            env2.fund(XRP(1000), dave);
            env2.close();
            auto jv = passkeyListSet(dave, pq, kPasskeyId);
            auto& pk = jv[sfPasskeys.jsonName][0u][sfPasskey.jsonName][sfPublicKey.jsonName];
            pk = pk.asString().substr(2);
            env2(jv, Ter(temMALFORMED));
        }
    }

    void
    testSignatureBeforeAmendment(FeatureBitset features)
    {
        testcase("an ML-DSA-44 PasskeySignature is refused without the amendment");
        using namespace test::jtx;

        // The ML-DSA-44 key is alice's own master key, so no passkey list is
        // needed: only the signature check is exercised. Each amendment
        // PasskeyMLDSA needs is removed in turn, with and without
        // fixP256StrictDer, which changes why it is refused (a
        // PasskeySignature next to a key that may not carry one; without the
        // fix, the PasskeySignature is ignored and there is no TxnSignature).
        for (auto const& without :
             {featurePasskeyMLDSA, featureQuantum, featurePasskey, fixP256StrictDer})
        {
            for (bool const strict : {true, false})
            {
                auto const rules =
                    strict ? features - without : features - without - fixP256StrictDer;
                Env env{*this, envconfig(), rules};
                Account const alice{"alice", KeyType::Dilithium};
                Account const bob{"bob"};
                env.fund(XRP(1000), alice, bob);
                env.close();

                env(pay(alice, bob, XRP(10)), WebAuthnSig(alice, kPasskeyId), invalidSignature());
                // Not cached: the same answer, not "Transaction has bad
                // signature.", on a second submission.
                auto jt = env.jt(pay(alice, bob, XRP(10)), WebAuthnSig(alice, kPasskeyId));
                expectRefused(jt);
                env.submit(jt);
                env.submit(jt);
                env.close();
                BEAST_EXPECT(env.balance(bob) == XRP(1000));
            }
        }
    }

    void
    testPayment(FeatureBitset features)
    {
        testcase("an ML-DSA-44 passkey pays through WebAuthn");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        auto const jt = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        if (!BEAST_EXPECT(jt.stx))
            return;
        // The wire format: an ML-DSA-44 SigningPubKey, no TxnSignature, and
        // a 2 420-byte signature in the PasskeySignature.
        BEAST_EXPECT(jt.stx->getSigningPubKey().size() == 1312);
        BEAST_EXPECT(!jt.stx->isFieldPresent(sfTxnSignature));
        BEAST_EXPECT(
            jt.stx->getFieldObject(sfPasskeySignature).getFieldVL(sfSignature).size() == 2420);
        BEAST_EXPECT(STTx::getSignature(*jt.stx).size() == 2420);

        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));

        // As a P-256 passkey, the key of the list may also sign without
        // WebAuthn: a passkey has full authority over the account.
        env(pay(alice, bob, XRP(1)), Sig(pq));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1101));
    }

    void
    testBadAssertions(FeatureBitset features)
    {
        testcase("ML-DSA-44 assertions that do not match the transaction");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        // A challenge over other bytes: the signing data of another payment.
        {
            auto other = env.jt(pay(alice, bob, XRP(1)), WebAuthnSig(pq, kPasskeyId));
            env(pay(alice, bob, XRP(100)),
                WebAuthnSig(pq, kPasskeyId, {.challenge = signingData(other.jv)}),
                invalidSignature());
        }

        // A registration ceremony instead of an assertion.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(pq, kPasskeyId, {.type = "webauthn.create"}),
            invalidSignature());

        // No challenge at all.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(pq, kPasskeyId, {.omitChallenge = true}),
            invalidSignature());

        // A signature that does not verify.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(pq, kPasskeyId, {.alterSignature = true}),
            invalidSignature());

        // AuthenticatorData changed after signing.
        env(pay(alice, bob, XRP(100)),
            WebAuthnSig(pq, kPasskeyId, {.alterAuthenticatorData = true}),
            invalidSignature());

        auto const jt = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        if (!BEAST_EXPECT(jt.stx))
            return;
        auto const inPasskey = [](SField const& field, auto change) {
            return [&field, change](json::Value& jv) {
                auto& object = jv[sfPasskeySignature.jsonName];
                auto bytes = *strUnHex(object[field.jsonName].asString());
                change(bytes);
                object[field.jsonName] = strHex(bytes);
            };
        };
        auto const rules = env.current()->rules();
        auto const refusedForms = {
            // A truncated signature: ML-DSA-44 signatures are 2 420 bytes.
            edited(jt, inPasskey(sfSignature, [](Blob& b) { b.pop_back(); })),
            // A signature with a byte appended.
            edited(jt, inPasskey(sfSignature, [](Blob& b) { b.push_back(0); })),
            // A TxnSignature next to the PasskeySignature: it would only
            // change the transaction's ID.
            edited(jt, [&](json::Value& jv) { jv[sfTxnSignature.jsonName] = "00"; }),
            // A P-256 DER signature in place of the ML-DSA-44 one.
            edited(
                jt,
                [](json::Value& jv) {
                    jv[sfPasskeySignature.jsonName][sfSignature.jsonName] = "3006020101020101";
                }),
        };
        for (auto const& variant : refusedForms)
        {
            if (!BEAST_EXPECT(variant.stx))
                return;
            BEAST_EXPECT(variant.stx->getTransactionID() != jt.stx->getTransactionID());
            BEAST_EXPECT(!variant.stx->checkSign(rules));
        }

        // A TxnSignature next to it, even a valid one by the same key, is
        // refused.
        {
            auto const raw = env.jt(pay(alice, bob, XRP(100)), Sig(pq));
            auto const both = edited(jt, [&](json::Value& jv) {
                jv[sfTxnSignature.jsonName] = raw.jv[sfTxnSignature.jsonName];
            });
            if (BEAST_EXPECT(raw.stx && both.stx))
            {
                BEAST_EXPECT(raw.stx->checkSign(rules));
                BEAST_EXPECT(!both.stx->checkSign(rules));
            }
        }

        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1000));

        // The control: the same payment, nothing altered.
        BEAST_EXPECT(jt.stx->checkSign(rules));
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

    // `hex` with the lowest bit of its byte at `index` flipped.
    static std::string
    flipBit(std::string const& hex, std::size_t index)
    {
        auto bytes = *strUnHex(hex);
        bytes[index] ^= 0x01;
        return strHex(bytes);
    }

    void
    testIndependentVector(FeatureBitset features)
    {
        testcase("an assertion made by an independent ML-DSA-44 implementation");
        using namespace test::jtx;

        auto const tx = [](std::string const& authenticatorData, std::string const& signature) {
            json::Value jv;
            jv[jss::TransactionType] = jss::Payment;
            jv[jss::Account] = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
            jv[jss::Destination] = "rPMh7Pi9ct699iZUTWaytJUoHcJ7cgyziK";
            jv[jss::Amount] = "1000000";
            jv[jss::Fee] = "10";
            jv[jss::Sequence] = 1u;
            jv[jss::Flags] = 0u;
            jv[jss::SigningPubKey] = vector::kPublicKey;
            auto& passkeySignature = jv[sfPasskeySignature.jsonName];
            passkeySignature[sfPasskeyID.jsonName] = kPasskeyId;
            passkeySignature[sfAuthenticatorData.jsonName] = authenticatorData;
            passkeySignature[sfClientDataJSON.jsonName] = vector::kClientDataJSON;
            passkeySignature[sfSignature.jsonName] = signature;
            return jv;
        };
        auto const sttx = [](json::Value const& jv) { return STTx(test::jtx::parse(jv)); };

        auto const jv = tx(vector::kAuthenticatorData, vector::kSignature);
        // rippled and ripple-binary-codec agree on the signing data, which
        // is what the challenge encodes.
        BEAST_EXPECT(strHex(signingData(jv)) == vector::kSigningData);
        BEAST_EXPECT(publicKeyType(makeSlice(*strUnHex(vector::kPublicKey))) == KeyType::Dilithium);

        Env post{*this, envconfig(), features};
        Env pre{*this, envconfig(), features - featurePasskeyMLDSA};
        auto const postRules = post.current()->rules();
        BEAST_EXPECT(sttx(jv).checkSign(postRules));
        BEAST_EXPECT(!sttx(jv).checkSign(pre.current()->rules()));

        // One bit changed in the signature (first byte, last byte) or in
        // AuthenticatorData: refused.
        BEAST_EXPECT(!sttx(tx(vector::kAuthenticatorData, flipBit(vector::kSignature, 0)))
                          .checkSign(postRules));
        BEAST_EXPECT(!sttx(tx(vector::kAuthenticatorData, flipBit(vector::kSignature, 2419)))
                          .checkSign(postRules));
        BEAST_EXPECT(!sttx(tx(flipBit(vector::kAuthenticatorData, 32), vector::kSignature))
                          .checkSign(postRules));
    }

    void
    testOtherSigningPaths(FeatureBitset features)
    {
        testcase("the PasskeyID binding on the delegate, Batch and sponsor paths");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const carol{"carol"};
        Account const dave{"dave"};
        Account const pq{"pq", KeyType::Dilithium};
        Account const davePq{"davePq", KeyType::Dilithium};
        env.fund(XRP(10000), alice, bob, carol, dave);
        env.close();
        env(passkeyListSet(alice, pq, kPasskeyId));
        env(passkeyListSet(dave, davePq, kPasskeyId));
        env(delegate::set(alice, dave, {"Payment"}));
        env.close();

        // A delegate signs with its own ML-DSA-44 passkey: the list read is
        // the delegate's, and the PasskeyID must be the one registered there.
        env(pay(alice, bob, XRP(1)),
            delegate::As(dave),
            WebAuthnSig(davePq, kOtherPasskeyId),
            Ter(tefBAD_AUTH));
        env(pay(alice, bob, XRP(1)),
            delegate::As(dave),
            WebAuthnSig(pq, kPasskeyId),
            Ter(tefBAD_AUTH));
        env(pay(alice, bob, XRP(1)), delegate::As(dave), WebAuthnSig(davePq, kPasskeyId));
        env.close();

        // An outer Batch signed by the account's ML-DSA-44 passkey.
        auto const batchFee = batch::calcBatchFee(env, 0, 2);
        auto const seq = env.seq(alice);
        env(batch::outer(alice, seq, batchFee, tfAllOrNothing),
            batch::Inner(pay(alice, bob, XRP(1)), seq + 1),
            batch::Inner(pay(alice, bob, XRP(2)), seq + 2),
            WebAuthnSig(pq, kOtherPasskeyId),
            Ter(tefBAD_AUTH));
        env(batch::outer(alice, seq, batchFee, tfAllOrNothing),
            batch::Inner(pay(alice, bob, XRP(1)), seq + 1),
            batch::Inner(pay(alice, bob, XRP(2)), seq + 2),
            WebAuthnSig(pq, kPasskeyId));
        env.close();

        // A sponsored transaction: the sponsor co-signs, and the account
        // signs at the top level with its passkey.
        env(pay(alice, bob, XRP(1)),
            Fee(XRP(1)),
            sponsor::As(carol, spfSponsorFee),
            Sig(sfSponsorSignature, carol),
            WebAuthnSig(pq, kOtherPasskeyId),
            Ter(tefBAD_AUTH));
        env(pay(alice, bob, XRP(1)),
            Fee(XRP(1)),
            sponsor::As(carol, spfSponsorFee),
            Sig(sfSponsorSignature, carol),
            WebAuthnSig(pq, kPasskeyId));
        env.close();

        BEAST_EXPECT(env.balance(bob) == XRP(10005));
    }

    // The upstream defect of PasskeyListSet being Delegable applies to
    // ML-DSA-44 passkeys too: a delegate registers its own ML-DSA-44 key in
    // the account's list and signs as the account. fixPasskeyListNotDelegable
    // refuses the delegation and the delegated PasskeyListSet.
    void
    testDelegatedListSet(FeatureBitset features)
    {
        testcase("a delegate cannot register its own ML-DSA-44 passkey for the account");
        using namespace test::jtx;

        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const carol{"carol"};
        Account const bobPq{"bobPq", KeyType::Dilithium};

        // Before the fix: the takeover works.
        {
            Env env{*this, envconfig(), features - fixPasskeyListNotDelegable};
            env.fund(XRP(1000), alice, bob, carol);
            env.close();
            env(delegate::set(alice, bob, {"PasskeyListSet"}));
            env.close();
            env(passkeyListSet(alice, bobPq, kPasskeyId), delegate::As(bob));
            env.close();
            env(pay(alice, carol, XRP(100)), WebAuthnSig(bobPq, kPasskeyId));
            env(pay(alice, carol, XRP(100)), Sig(bobPq));
            env.close();
            BEAST_EXPECT(env.balance(carol) == XRP(1200));
        }

        // With the fix: refused, and bob's key has no authority.
        {
            Env env{*this, envconfig(), features};
            env.fund(XRP(1000), alice, bob, carol);
            env.close();
            env(delegate::set(alice, bob, {"PasskeyListSet"}), Ter(temMALFORMED));
            env(passkeyListSet(alice, bobPq, kPasskeyId), delegate::As(bob), Ter(temINVALID));
            env.close();
            BEAST_EXPECT(!env.le(keylet::passkeyList(alice.id())));
            env(pay(alice, carol, XRP(100)), WebAuthnSig(bobPq, kPasskeyId), Ter(tefBAD_AUTH));
            env(pay(alice, carol, XRP(100)), Sig(bobPq), Ter(tefBAD_AUTH));
            env.close();
            BEAST_EXPECT(env.balance(carol) == XRP(1000));
        }
    }

    void
    testSessionKeyAddedToList(FeatureBitset features)
    {
        testcase(
            "a session key added to the passkey list signs through WebAuthn after the session");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const key{"key", KeyType::Dilithium};
        env.fund(XRP(1000), alice, bob);
        env.close();

        // The opening checks the list, which does not exist yet; the key is
        // registered as a passkey afterwards.
        env(session::set(alice, key, 600), Txflags(tfAllTransactions));
        env.close();
        env(passkeyListSet(alice, key, kPasskeyId));
        env.close();

        // While the session lives, the key's transactions take the session
        // path, where an ML-DSA-44 passkey signature has no authority.
        env(pay(alice, bob, XRP(1)),
            WebAuthnSig(key, kPasskeyId),
            LastLedgerSeq(env.current()->seq() + 10),
            Ter(tefBAD_AUTH));
        env(session::del(alice, key));
        env.close();
        env(pay(alice, bob, XRP(1)), WebAuthnSig(key, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1001));
    }

    void
    testNotInList(FeatureBitset features)
    {
        testcase("an ML-DSA-44 key that is not in the list has no authority");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        Account const stranger{"stranger", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        // The assertion verifies, so the refusal is the ledger's.
        env(pay(alice, bob, XRP(100)), WebAuthnSig(stranger, kPasskeyId), Ter(tefBAD_AUTH));
        // alice's passkey does not sign for bob, who has no list.
        env(pay(bob, alice, XRP(100)), WebAuthnSig(pq, kPasskeyId), Ter(tefBAD_AUTH));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1000));
    }

    void
    testPasskeyIdBound(FeatureBitset features)
    {
        testcase("an ML-DSA-44 passkey signature is bound to its list entry");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        // Another PasskeyID than the one registered with the key: the
        // assertion verifies (the PasskeyID is not signed), the transaction
        // has another ID, and the ledger refuses it.
        auto const good = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        auto const other = env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kOtherPasskeyId));
        if (!BEAST_EXPECT(good.stx && other.stx))
            return;
        BEAST_EXPECT(good.stx->getTransactionID() != other.stx->getTransactionID());
        BEAST_EXPECT(other.stx->checkSign(env.current()->rules()));
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kOtherPasskeyId), Ter(tefBAD_AUTH));

        // An ML-DSA-44 master key, or RegularKey, signing through WebAuthn:
        // not a passkey of the list, so not authorized, although the same key
        // signs with a TxnSignature.
        Account const carol{"carol", KeyType::Dilithium};
        Account const regular{"regular", KeyType::Dilithium};
        env.fund(XRP(1000), carol);
        env.close();
        env(pay(carol, bob, XRP(1)), WebAuthnSig(carol, kPasskeyId), Ter(tefBAD_AUTH));
        env(pay(carol, bob, XRP(1)));
        env(regkey(alice, regular));
        env.close();
        env(pay(alice, bob, XRP(1)), WebAuthnSig(regular, kPasskeyId), Ter(tefBAD_AUTH));
        env(pay(alice, bob, XRP(1)), Sig(regular));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1002));

        // The control.
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1102));
    }

    void
    testChallengeAsBytes(FeatureBitset features)
    {
        testcase("the ML-DSA-44 path compares the challenge as bytes");
        using namespace test::jtx;

        // The signing data holds a 1 312-byte key, with bytes at or above
        // 0x80; the ML-DSA-44 path is new and always compares bytes, so it
        // does not depend on fixPasskeyChallenge.
        Env env{*this, envconfig(), features - fixPasskeyChallenge};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

    void
    testFullyPostQuantum(FeatureBitset features)
    {
        testcase("an account whose only authority is an ML-DSA-44 passkey");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        setUp(env, alice, bob, pq);

        // The RegularKey is the black hole address, whose key nobody holds;
        // then the master key is disabled.
        json::Value blackhole;
        blackhole[jss::Account] = alice.human();
        blackhole[jss::TransactionType] = jss::SetRegularKey;
        blackhole[sfRegularKey.jsonName] = toBase58(noAccount());
        env(blackhole);
        env(fset(alice, asfDisableMaster), Sig(alice));
        env.close();

        env(pay(alice, bob, XRP(1)), Sig(alice), Ter(tefMASTER_DISABLED));
        env(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));

        // The passkey keeps full authority: it can still change the account.
        env(fset(alice, asfRequireDest), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.le(alice)->isFlag(lsfRequireDestTag));
    }

    void
    testSession(FeatureBitset features)
    {
        testcase("an ML-DSA-44 passkey opens and closes a signing session");
        using namespace test::jtx;

        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        Account const key{"session", KeyType::Dilithium};
        setUp(env, alice, bob, pq);
        auto const lls = [&] { return LastLedgerSeq(env.current()->seq() + 10); };

        // The passkey itself cannot be a session key.
        env(session::set(alice, pq, 600),
            Txflags(tfAllTransactions),
            WebAuthnSig(pq, kPasskeyId),
            Ter(tecNO_PERMISSION));

        env(session::set(alice, key, 600),
            session::Permissions({"Payment"}),
            WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(env.le(keylet::signingSession(alice.id(), key.id())));

        // The session key signs a payment. Through WebAuthn its ML-DSA-44 key
        // does not: an ML-DSA-44 passkey signature authorizes only through
        // the passkey list.
        env(pay(alice, bob, XRP(1)), Sig(key), lls());
        env(pay(alice, bob, XRP(1)), WebAuthnSig(key, kOtherPasskeyId), lls(), Ter(tefBAD_AUTH));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1001));

        // The passkey closes it, as any key with full authority.
        env(session::del(alice, key), WebAuthnSig(pq, kPasskeyId));
        env.close();
        BEAST_EXPECT(!env.le(keylet::signingSession(alice.id(), key.id())));
        env(pay(alice, bob, XRP(1)), Sig(key), lls(), Ter(tefBAD_AUTH));
    }

    void
    testP256Unchanged(FeatureBitset features)
    {
        testcase("P-256 passkeys are unchanged by the amendment");
        using namespace test::jtx;

        for (bool const enabled : {false, true})
        {
            Env env{*this, envconfig(), enabled ? features : features - featurePasskeyMLDSA};
            Account const alice{"alice"};
            Account const bob{"bob"};
            Account const p256{"p256", KeyType::P256};
            setUp(env, alice, bob, p256);
            env(pay(alice, bob, XRP(100)), WebAuthnSig(p256, kPasskeyId));
            env(pay(alice, bob, XRP(100)),
                WebAuthnSig(p256, kPasskeyId, {.alterSignature = true}),
                invalidSignature());
            env.close();
            BEAST_EXPECT(env.balance(bob) == XRP(1100));
        }

        // Both kinds in one list, each signing.
        Env env{*this, envconfig(), features};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const p256{"p256", KeyType::P256};
        Account const pq{"pq", KeyType::Dilithium};
        env.fund(XRP(1000), alice, bob);
        env.close();
        env(passkeyListSet(alice, {{p256, kPasskeyId}, {pq, kOtherPasskeyId}}));
        env.close();
        env(pay(alice, bob, XRP(10)), WebAuthnSig(p256, kPasskeyId));
        env(pay(alice, bob, XRP(10)), WebAuthnSig(pq, kOtherPasskeyId));
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1020));
    }

    void
    testActivation(FeatureBitset features)
    {
        testcase("a blob refused before the amendment is accepted after it");
        using namespace test::jtx;

        // The same signed blob is submitted before and after the amendment.
        // A bad verdict cached before it would refuse the blob after it. The
        // passkey can only be registered after the amendment, so the blob
        // takes the sequence that follows the registration.
        Env env{*this, envconfig(), features - featurePasskeyMLDSA};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        env.fund(XRP(1000), alice, bob);
        env.close();

        auto jt =
            env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId), Seq(env.seq(alice) + 1));
        expectRefused(jt);
        env.submit(jt);
        env.close();

        env.enableFeature(featurePasskeyMLDSA);
        env.close();
        BEAST_EXPECT(env.current()->rules().enabled(featurePasskeyMLDSA));
        env(passkeyListSet(alice, pq, kPasskeyId));
        env.close();
        expectApplied(jt);
        env.submit(jt);
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

    void
    testCacheableCondition(FeatureBitset features)
    {
        testcase("which signature verdicts are kept before the amendment");
        using namespace test::jtx;

        Env pre{*this, envconfig(), features - featurePasskeyMLDSA};
        Env noQuantum{*this, envconfig(), features - featureQuantum};
        Env post{*this, envconfig(), features};
        auto const preRules = pre.current()->rules();
        auto const noQuantumRules = noQuantum.current()->rules();
        auto const postRules = post.current()->rules();

        Account const alice{"alice", KeyType::Dilithium};
        Account const bob{"bob"};
        post.fund(XRP(1000), alice, bob);
        post.close();

        // An ML-DSA-44 SigningPubKey with a PasskeySignature: kept only once
        // the amendment, and the ones it needs, are enabled.
        auto const webAuthn = post.jt(pay(alice, bob, XRP(1)), WebAuthnSig(alice, kPasskeyId));
        if (!BEAST_EXPECT(webAuthn.stx))
            return;
        BEAST_EXPECT(!isSignatureVerdictCacheable(*webAuthn.stx, preRules));
        BEAST_EXPECT(!isSignatureVerdictCacheable(*webAuthn.stx, noQuantumRules));
        {
            Env noStrict{*this, envconfig(), features - fixP256StrictDer};
            BEAST_EXPECT(!isSignatureVerdictCacheable(*webAuthn.stx, noStrict.current()->rules()));
        }
        BEAST_EXPECT(isSignatureVerdictCacheable(*webAuthn.stx, postRules));

        // The same key signing without WebAuthn: unchanged, kept.
        auto const raw = post.jt(pay(alice, bob, XRP(1)));
        if (!BEAST_EXPECT(raw.stx))
            return;
        BEAST_EXPECT(isSignatureVerdictCacheable(*raw.stx, preRules));

        // The PasskeySignature next to a secp256k1 key: unchanged, kept (the
        // amendment does not touch that path).
        Account const carol{"carol"};
        auto const secp = edited(webAuthn, [&](json::Value& jv) {
            jv[jss::SigningPubKey] = strHex(carol.pk().slice());
        });
        if (!BEAST_EXPECT(secp.stx))
            return;
        BEAST_EXPECT(isSignatureVerdictCacheable(*secp.stx, preRules));
    }

    void
    testCacheAcrossActivation(FeatureBitset features)
    {
        testcase("no ML-DSA-44 PasskeySignature verdict crosses the amendment");
        using namespace test::jtx;

        // Two environments give the rules on each side of the amendment, and
        // one router holds the verdicts, as on a node whose validated rules
        // lag its open ledger at the flag ledger.
        Env pre{*this, envconfig(), features - featurePasskeyMLDSA};
        Env post{*this, envconfig(), features};
        Env noStrict{*this, envconfig(), features - fixP256StrictDer};
        auto const preRules = pre.current()->rules();
        auto const postRules = post.current()->rules();
        auto const noStrictRules = noStrict.current()->rules();

        Account const alice{"alice", KeyType::Dilithium};
        Account const bob{"bob"};
        post.fund(XRP(1000), alice, bob);
        post.close();
        auto& router = post.app().getHashRouter();

        // Refused before, accepted after: a bad verdict must not be kept.
        auto const webAuthn = post.jt(pay(alice, bob, XRP(1)), WebAuthnSig(alice, kPasskeyId));
        if (!BEAST_EXPECT(webAuthn.stx))
            return;
        auto const id = webAuthn.stx->getTransactionID();
        BEAST_EXPECT(checkValidity(router, *webAuthn.stx, preRules).first == Validity::SigBad);
        BEAST_EXPECT(router.getFlags(id) == HashRouterFlags::UNDEFINED);
        BEAST_EXPECT(checkValidity(router, *webAuthn.stx, postRules).first == Validity::Valid);
        BEAST_EXPECT(checkValidity(router, *webAuthn.stx, preRules).first == Validity::SigBad);

        // Accepted before, refused after: PasskeyMLDSA needs
        // fixP256StrictDer, and without it a PasskeySignature next to an
        // ML-DSA-44 key is ignored, so a valid TxnSignature carries the
        // transaction; once both are enabled, the PasskeySignature is checked
        // and a TxnSignature next to it is refused. A good verdict kept
        // before fixP256StrictDer would let it through after.
        auto const raw = post.jt(pay(alice, bob, XRP(2)));
        if (!BEAST_EXPECT(raw.stx))
            return;
        auto const both = edited(raw, [&](json::Value& jv) {
            jv[sfPasskeySignature.jsonName] = webAuthn.jv[sfPasskeySignature.jsonName];
        });
        if (!BEAST_EXPECT(both.stx))
            return;
        BEAST_EXPECT(checkValidity(router, *both.stx, noStrictRules).first == Validity::Valid);
        BEAST_EXPECT(checkValidity(router, *both.stx, postRules).first == Validity::SigBad);
        BEAST_EXPECT(checkValidity(router, *both.stx, noStrictRules).first == Validity::Valid);
    }

    void
    testForcedVerdict(FeatureBitset features)
    {
        testcase("a forced verdict holds on both sides of the amendment");
        using namespace test::jtx;

        Env pre{*this, envconfig(), features - featurePasskeyMLDSA};
        Env post{*this, envconfig(), features};
        auto const preRules = pre.current()->rules();
        auto const postRules = post.current()->rules();

        Account const alice{"alice", KeyType::Dilithium};
        Account const bob{"bob"};
        post.fund(XRP(1000), alice, bob);
        post.close();

        // A signature that verifies in no era: only the forced verdict can
        // make the checks below pass.
        auto const jt = post.jt(
            pay(alice, bob, XRP(1)), WebAuthnSig(alice, kPasskeyId, {.alterSignature = true}));
        if (!BEAST_EXPECT(jt.stx))
            return;
        auto& router = pre.app().getHashRouter();
        forceValidity(router, jt.stx->getTransactionID(), Validity::SigGoodOnly);
        BEAST_EXPECT(checkValidity(router, *jt.stx, preRules).first != Validity::SigBad);
        BEAST_EXPECT(checkValidity(router, *jt.stx, postRules).first != Validity::SigBad);
    }

    void
    testNetworkOPsDoesNotMarkBad(FeatureBitset features)
    {
        testcase("NetworkOPs does not mark an ML-DSA-44 PasskeySignature bad before the amendment");
        using namespace test::jtx;

        Env env{*this, envconfig(), features - featurePasskeyMLDSA};
        Account const alice{"alice"};
        Account const bob{"bob"};
        Account const pq{"pq", KeyType::Dilithium};
        env.fund(XRP(1000), alice, bob);
        env.close();

        auto jt =
            env.jt(pay(alice, bob, XRP(100)), WebAuthnSig(pq, kPasskeyId), Seq(env.seq(alice) + 1));
        if (!BEAST_EXPECT(jt.stx))
            return;
        auto const id = jt.stx->getTransactionID();

        std::string reason;
        auto tx = std::make_shared<Transaction>(jt.stx, reason, env.app());
        env.app().getOPs().processTransaction(tx, false, true, NetworkOPs::FailHard::No);
        BEAST_EXPECT(tx->getResult() == temBAD_SIGNATURE);
        BEAST_EXPECT(!any(env.app().getHashRouter().getFlags(id) & HashRouterFlags::BAD));

        env.enableFeature(featurePasskeyMLDSA);
        env.close();
        env(passkeyListSet(alice, pq, kPasskeyId));
        env.close();
        env.submit(jt);
        env.close();
        BEAST_EXPECT(env.balance(bob) == XRP(1100));
    }

public:
    void
    run() override
    {
        using namespace test::jtx;
        auto const all = testableAmendments();

        testListSet(all);
        testSignatureBeforeAmendment(all);
        testPayment(all);
        testBadAssertions(all);
        testIndependentVector(all);
        testNotInList(all);
        testPasskeyIdBound(all);
        testOtherSigningPaths(all);
        testDelegatedListSet(all);
        testChallengeAsBytes(all);
        testFullyPostQuantum(all);
        testSession(all);
        testSessionKeyAddedToList(all);
        testP256Unchanged(all);
        testActivation(all);
        testCacheableCondition(all);
        testCacheAcrossActivation(all);
        testForcedVerdict(all);
        testNetworkOPsDoesNotMarkBad(all);
    }
};

BEAST_DEFINE_TESTSUITE(PasskeyMLDSA, app, xrpl);

}  // namespace xrpl
