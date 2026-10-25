import { ContainerModule } from "inversify";

import { pqTypes } from "@internal/use-cases/pq/di/pqTypes";
import { GetPqPublicKeyUseCase } from "@internal/use-cases/pq/GetPqPublicKeyUseCase";
import { SignTransactionPqUseCase } from "@internal/use-cases/pq/SignTransactionPqUseCase";

export const pqModuleFactory = () =>
  new ContainerModule(({ bind }) => {
    bind(pqTypes.GetPqPublicKeyUseCase).to(GetPqPublicKeyUseCase);
    bind(pqTypes.SignTransactionPqUseCase).to(SignTransactionPqUseCase);
  });
