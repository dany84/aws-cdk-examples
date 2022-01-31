import {Construct} from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import {readFileSync} from "fs";

export interface RouteServerConstructProps {
    instanceName: string;
    vpc: ec2.Vpc;
    ec2Role: iam.Role;
    securityGroup: ec2.SecurityGroup;
    publicSubnet: ec2.Subnet;
    privateENISubnet: ec2.Subnet;
}

export class RouteServer extends Construct {

    public readonly privateENI: ec2.CfnNetworkInterface;
    public readonly ec2Instance: ec2.Instance

    constructor(scope: Construct, id: string, props: RouteServerConstructProps) {
        super(scope, id);

        const routerServer1 = new ec2.Instance(this, 'ROUTER', {
            instanceName: props.instanceName,
            vpc: props.vpc,
            vpcSubnets: {subnets: [props.publicSubnet]},
            role: props.ec2Role,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.genericLinux({
                'us-east-1': 'ami-0ac80df6eff0e70b5'
            }),
            securityGroup: props.securityGroup,
            sourceDestCheck: false,
            userData: ec2.UserData.custom(readFileSync('./lib/onprem-user-data.sh', 'utf8'))
        });
        this.ec2Instance = routerServer1;

        this.privateENI = new ec2.CfnNetworkInterface(this, 'ENI_PRIVATE', {
            subnetId: props.privateENISubnet.subnetId,
            groupSet: [props.securityGroup.securityGroupId],
            sourceDestCheck: false,
            tags: [{key: 'Name', value: 'ENI_PRIVATE' + props.instanceName}]
        });
        new ec2.CfnNetworkInterfaceAttachment(this, 'ENIAttachmentRouter', {
            instanceId: routerServer1.instanceId,
            networkInterfaceId: this.privateENI.ref,
            deviceIndex: '1'
        });
    }
}