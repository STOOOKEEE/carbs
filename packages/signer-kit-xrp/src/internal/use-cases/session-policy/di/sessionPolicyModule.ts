import { ContainerModule } from "inversify";

import { sessionPolicyTypes } from "@internal/use-cases/session-policy/di/sessionPolicyTypes";
import { GetSessionPolicyUseCase } from "@internal/use-cases/session-policy/GetSessionPolicyUseCase";

export const sessionPolicyModuleFactory = () =>
  new ContainerModule(({ bind }) => {
    bind(sessionPolicyTypes.GetSessionPolicyUseCase).to(
      GetSessionPolicyUseCase,
    );
  });
