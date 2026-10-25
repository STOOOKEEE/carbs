import { ContainerModule } from "inversify";

import { pqTypes } from "@internal/use-cases/pq/di/pqTypes";
import { GetPqPublicKeyUseCase } from "@internal/use-cases/pq/GetPqPublicKeyUseCase";

export const pqModuleFactory = () =>
  new ContainerModule(({ bind }) => {
    bind(pqTypes.GetPqPublicKeyUseCase).to(GetPqPublicKeyUseCase);
  });
