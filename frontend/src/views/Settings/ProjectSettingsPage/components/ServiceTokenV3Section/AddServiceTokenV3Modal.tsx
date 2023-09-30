import { useEffect } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form"; 
import { faPlus,faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { yupResolver } from "@hookform/resolvers/yup";
import nacl from "tweetnacl";
import { encodeBase64 } from "tweetnacl-util";
import * as yup from "yup";

import { useNotificationContext } from "@app/components/context/Notifications/NotificationProvider";
import {
    decryptAssymmetric,
    encryptAssymmetric
} from "@app/components/utilities/cryptography/crypto";
import {
    Button,
    FormControl,
    IconButton,
    Input,
    Modal,
    ModalContent,
    Select,
    SelectItem,
    // Accordion,
    // AccordionItem,
    // AccordionTrigger,
    // AccordionContent
} from "@app/components/v2";
import { useWorkspace } from "@app/context";
import { 
    useCreateServiceTokenV3,
    useGetUserWsKey,
    useUpdateServiceTokenV3
} from "@app/hooks/api";
import {
    Permission
} from "@app/hooks/api/serviceTokens/enums";
import { UsePopUpState } from "@app/hooks/usePopUp";

const expirations = [
    { label: "Never", value: undefined },
    { label: "1 day", value: "86400" },
    { label: "7 days", value: "604800" },
    { label: "1 month", value: "2592000" },
    { label: "6 months", value: "15552000" },
    { label: "12 months", value: "31104000" }
];

const permissionsMap: {
    "read": Permission[],
    "readWrite": Permission[]
} = {
    "read": [Permission.READ],
    "readWrite": [Permission.READ, Permission.WRITE],
}

const schema = yup.object({
    name: yup.string().required("ST V3 name is required"),
    expiresIn: yup.string(),
    scopes: yup
    .array(
      yup.object({
        permission: yup.string().oneOf(Object.keys(permissionsMap), "Invalid permission").required().label("Permission") as yup.SchemaOf<"read" | "readWrite", object>,
        environment: yup.string().max(50).required().label("Environment"),
        secretPath: yup
          .string()
          .required()
          .default("/")
          .label("Secret Path")
          .transform((val) =>
            typeof val === "string" && val.at(-1) === "/" && val.length > 1 ? val.slice(0, -1) : val
          )
      })
    )
    .min(1)
    .required()
    .label("Scope")
}).required();

export type FormData = yup.InferType<typeof schema>;

type Props = {
  popUp: UsePopUpState<["serviceTokenV3"]>;
  handlePopUpToggle: (popUpName: keyof UsePopUpState<["serviceTokenV3"]>, state?: boolean) => void;
};

export const AddServiceTokenV3Modal = ({
    popUp,
    handlePopUpToggle
}: Props) => {
    const { currentWorkspace } = useWorkspace();

    const { data: latestFileKey } = useGetUserWsKey(currentWorkspace?._id ?? "");
    const { mutateAsync: createMutateAsync } = useCreateServiceTokenV3();
    const { mutateAsync: updateMutateAsync } = useUpdateServiceTokenV3();
    const { createNotification } = useNotificationContext();
    const {
        control,
        handleSubmit,
        reset,
        formState: { isSubmitting }
    } = useForm<FormData>({
        resolver: yupResolver(schema),
        defaultValues: {
            name: "",
            scopes: [{ 
                permission: "read",
                environment: currentWorkspace?.environments?.[0]?.slug,
                secretPath: "/", 
            }]
        }
    });
    
    useEffect(() => {
        const serviceTokenData = popUp?.serviceTokenV3?.data as { 
            serviceTokenDataId: string;
            name: string;
            scopes: any;
        };
        
        if (serviceTokenData) {
            reset({
                name: serviceTokenData.name,
                scopes: serviceTokenData.scopes.map((scope) => {
                    let permission = "read";
                    if (scope.permissions.includes(Permission.WRITE)) {
                        permission = "readWrite";
                    }
                    
                    return ({
                        environment: scope.environment,
                        secretPath: scope.secretPath,
                        permission
                    })
                })
            });
        } else {
            reset({
                name: "",
                scopes: [{ 
                    permission: "read",
                    environment: currentWorkspace?.environments?.[0]?.slug,
                    secretPath: "/", 
                }]
            });
        }
    }, [popUp?.serviceTokenV3?.data]);
    
    const { fields: tokenScopes, append, remove } = useFieldArray({ control, name: "scopes" });
    
    const onFormSubmit = async ({
        name,
        expiresIn,
        scopes
    }: FormData) => {
        try {
            const serviceTokenData = popUp?.serviceTokenV3?.data as { 
                serviceTokenDataId: string;
                name: string;
                scopes: any;
            };
            
            // convert read/readWrite permission => ["read", "write"] format
            const reformattedScopes = scopes.map((scope) => {
                return ({
                    environment: scope.environment,
                    secretPath: scope.secretPath,
                    permissions: permissionsMap[scope.permission]
                });
            })
            
            if (serviceTokenData) {
                // update
                await updateMutateAsync({
                    serviceTokenDataId: serviceTokenData.serviceTokenDataId,
                    name,
                    scopes: reformattedScopes,
                    expiresIn: expiresIn === "" ? undefined : Number(expiresIn)
                });
            } else {
                // create
                if (!currentWorkspace?._id) return;
                if (!latestFileKey) return;
                
                const pair = nacl.box.keyPair();
                const secretKeyUint8Array = pair.secretKey;
                const publicKeyUint8Array = pair.publicKey;
                const privateKey = encodeBase64(secretKeyUint8Array);
                const publicKey = encodeBase64(publicKeyUint8Array);
                
                const key = decryptAssymmetric({
                    ciphertext: latestFileKey.encryptedKey,
                    nonce: latestFileKey.nonce,
                    publicKey: latestFileKey.sender.publicKey,
                    privateKey: localStorage.getItem("PRIVATE_KEY") as string
                });
                
                const { ciphertext, nonce } = encryptAssymmetric({
                    plaintext: key,
                    publicKey,
                    privateKey: localStorage.getItem("PRIVATE_KEY") as string
                });

                const { serviceToken } = await createMutateAsync({
                    name,
                    workspaceId: currentWorkspace._id,
                    publicKey,
                    scopes: reformattedScopes,
                    expiresIn: expiresIn === "" ? undefined : Number(expiresIn),
                    encryptedKey: ciphertext,
                    nonce
                });
                
                const downloadData = {
                    publicKey,
                    privateKey,
                    serviceToken
                };

                const blob = new Blob([JSON.stringify(downloadData, null, 2)], { type: "application/json" });
                const href = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = href;
                link.download = `infisical_${name}.json`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
            
            createNotification({
                text: `Successfully ${popUp?.serviceTokenV3?.data ? "updated" : "created"} ST V3`,
                type: "success"
            });

            reset();
            handlePopUpToggle("serviceTokenV3", false);
        } catch (err) {
            console.error(err);
            createNotification({
                text: `Failed to ${popUp?.serviceTokenV3?.data ? "updated" : "created"} ST V3`,
                type: "error"
            });
        }
    }
    
    return (
        <Modal
            isOpen={popUp?.serviceTokenV3?.isOpen}
                onOpenChange={(isOpen) => {
                handlePopUpToggle("serviceTokenV3", isOpen);
                reset();
            }}
        >
            <ModalContent title={`${popUp?.serviceTokenV3?.data ? "Update" : "Create"} Service Token V3`}>
                <form onSubmit={handleSubmit(onFormSubmit)}>
                    <Controller
                        control={control}
                        defaultValue=""
                        name="name"
                        render={({ field, fieldState: { error } }) => (
                            <FormControl
                                label="Name"
                                isError={Boolean(error)}
                                errorText={error?.message}
                            >
                            <Input 
                                {...field} 
                                placeholder="My ST V3"
                            />
                            </FormControl>
                        )}
                    />
                        {tokenScopes.map(({ id }, index) => (
                            <div className="flex items-end space-x-2 mb-3" key={id}>
                                <Controller
                                    control={control}
                                    name={`scopes.${index}.permission`}
                                    defaultValue={currentWorkspace?.environments?.[0]?.slug}
                                    render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                                        <FormControl
                                            className="mb-0"
                                            label={index === 0 ? "Permission" : undefined}
                                            errorText={error?.message}
                                            isError={Boolean(error)}
                                        >
                                        <Select
                                            defaultValue={field.value}
                                            {...field}
                                            onValueChange={(e) => onChange(e)}
                                            className="w-36"
                                        >
                                            <SelectItem value="read" key="st-v3-read">
                                                Read
                                            </SelectItem>
                                            <SelectItem value="readWrite" key="st-v3-write">
                                                Read &amp; Write
                                            </SelectItem>
                                        </Select>
                                        </FormControl>
                                    )}
                                />
                                <Controller
                                    control={control}
                                    name={`scopes.${index}.environment`}
                                    defaultValue={currentWorkspace?.environments?.[0]?.slug}
                                    render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                                        <FormControl
                                            className="mb-0"
                                            label={index === 0 ? "Environment" : undefined}
                                            errorText={error?.message}
                                            isError={Boolean(error)}
                                        >
                                        <Select
                                            defaultValue={field.value}
                                            {...field}
                                            onValueChange={(e) => onChange(e)}
                                            className="w-36"
                                        >
                                            {currentWorkspace?.environments.map(({ name, slug }) => (
                                            <SelectItem value={slug} key={slug}>
                                                {name}
                                            </SelectItem>
                                            ))}
                                        </Select>
                                        </FormControl>
                                    )}
                                />
                                <Controller
                                    control={control}
                                    name={`scopes.${index}.secretPath`}
                                    defaultValue="/"
                                    render={({ field, fieldState: { error } }) => (
                                        <FormControl
                                            className="mb-0 flex-grow"
                                            label={index === 0 ? "Secrets Path" : undefined}
                                            isError={Boolean(error)}
                                            errorText={error?.message}
                                        >
                                        <Input {...field} placeholder="can be /, /nested/**, /**/deep" />
                                        </FormControl>
                                    )}
                                />
                                <IconButton
                                    onClick={() => remove(index)}
                                    size="lg"
                                    colorSchema="danger"
                                    variant="plain"
                                    ariaLabel="update"
                                    className="p-3"
                                    >
                                    <FontAwesomeIcon icon={faXmark} />
                                </IconButton>
                            </div>
                        ))}
                        <div className="my-4 ml-1">
                            <Button
                                variant="outline_bg"
                                onClick={() =>
                                    append({
                                        permission: "read",
                                        environment: currentWorkspace?.environments?.[0]?.slug || "",
                                        secretPath: "/"
                                    })
                                }
                                leftIcon={<FontAwesomeIcon icon={faPlus} />}
                                size="xs"
                            >
                                Add Scope
                            </Button>
                        </div>
                        <Controller
                            control={control}
                            name="expiresIn"
                            defaultValue="15552000"
                            render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                                <FormControl
                                    label={`${popUp?.serviceTokenV3?.data ? "Update" : ""} Expire In`}
                                    errorText={error?.message}
                                    isError={Boolean(error)}
                                    className="mt-4"
                                >
                                    <Select
                                        defaultValue={field.value}
                                        {...field}
                                        onValueChange={(e) => onChange(e)}
                                        className="w-full"
                                    >
                                        {expirations.map(({ label, value }) => (
                                            <SelectItem value={String(value || "")} key={`api-key-expiration-${label}`}>
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}
                        />
                    {/* <Accordion 
                        type="multiple"
                        className="w-full"
                    >
                        <AccordionItem value="section-1">
                            <AccordionTrigger>Scopes</AccordionTrigger>
                            <AccordionContent>Description of Section 1</AccordionContent>
                        </AccordionItem>
                    </Accordion> */}
                    {/* <h3 className="text-mineshaft-400 text-sm mb-2">Temporariness</h3>
                    <Switch
                        id={`enable-ephemerality`}
                        onCheckedChange={(value) => setIsTemporary(value)}
                        isChecked={isTemporary}
                    >
                        <div className="w-96 mr-4">
                            <p className="text-gray-400 text-md">This token will be deactivated after your specified duration.</p>
                        </div>
                    </Switch>
                    {isTemporary && (
                        <Controller
                            control={control}
                            name="expiresIn"
                            defaultValue="15552000"
                            render={({ field: { onChange, ...field }, fieldState: { error } }) => (
                                <FormControl
                                    label="Duration"
                                    errorText={error?.message}
                                    isError={Boolean(error)}
                                    className="mt-4"
                                >
                                    <Select
                                        defaultValue={field.value}
                                        {...field}
                                        onValueChange={(e) => onChange(e)}
                                        className="w-full"
                                    >
                                        {expirations.map(({ label, value }) => (
                                            <SelectItem value={String(value || "")} key={`api-key-expiration-${label}`}>
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            )}
                        />
                    )} */}
                    <div className="mt-8 flex items-center">
                        <Button
                            className="mr-4"
                            size="sm"
                            type="submit"
                            isLoading={isSubmitting}
                            isDisabled={isSubmitting}
                        >
                            {popUp?.serviceTokenV3?.data ? "Update" : "Create"}
                        </Button>
                        <Button colorSchema="secondary" variant="plain">
                            Cancel
                        </Button>
                    </div>
                </form>
            </ModalContent>
        </Modal>
    );
}