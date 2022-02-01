import {CfnOutput, Stack, StackProps} from "aws-cdk-lib";
import {Construct} from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import {RouterType} from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import {RouteServer} from "./route-server";

export class SimulatedOnpremiseNetworkStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // VPC
        const vpc = new ec2.Vpc(this, 'ONPREM', {
            cidr: '192.168.8.0/21',
            enableDnsSupport: true,
            enableDnsHostnames: true,
            maxAzs: 1,
            natGateways: 0,
            subnetConfiguration: [],
        });

        // Subnets
        const subnetPub = new ec2.PublicSubnet(this, 'ONPREM-PUBLIC', {
            vpcId: vpc.vpcId,
            cidrBlock: '192.168.12.0/24',
            availabilityZone: Stack.of(this).availabilityZones[0],
            mapPublicIpOnLaunch: true
        });

        const subnetPrivate1 = new ec2.PrivateSubnet(this, 'ONPREM-PRIVATE-1', {
            vpcId: vpc.vpcId,
            cidrBlock: '192.168.10.0/24',
            availabilityZone: Stack.of(this).availabilityZones[0]
        });

        const subnetPrivate2 = new ec2.PrivateSubnet(this, 'ONPREM-PRIVATE-2', {
            vpcId: vpc.vpcId,
            cidrBlock: '192.168.11.0/24',
            availabilityZone: Stack.of(this).availabilityZones[0]
        });

        // Security Group
        const instanceSG = this.createInstanceSecurityGroup(vpc);

        // VPC endpoint
        /*
          Why only one interface endpoint, because Interface endpoint can only be set one by AZ.
         */

        const s3Endpoint = vpc.addGatewayEndpoint('S3Endpoint', {
            service: ec2.GatewayVpcEndpointAwsService.S3,
            subnets: [{subnets: [subnetPub, subnetPrivate1, subnetPrivate2]}]
        });
        const ssmVpcEndpoint = vpc.addInterfaceEndpoint('SSMEndpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM,
            subnets: {subnets: [subnetPub]},
            securityGroups: [instanceSG]
        });
        const ec2MessagesVpcEndpoint = vpc.addInterfaceEndpoint('EC2_MESSAGES_Endpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
            subnets: {subnets: [subnetPub]},
            securityGroups: [instanceSG]
        });
        const ssmMessagesEndpoint = vpc.addInterfaceEndpoint('SSM_MESSAGES_Endpoint', {
            service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
            subnets: {subnets: [subnetPub]},
            securityGroups: [instanceSG]
        });

        // Add Internet Gateway
        const igw = new ec2.CfnInternetGateway(this, 'IGW', {});
        const att = new ec2.CfnVPCGatewayAttachment(this, 'VPCGW', {
            internetGatewayId: igw.ref,
            vpcId: vpc.vpcId,
        });
        subnetPub.addDefaultInternetRoute(igw.ref, att);

        // Routers
        const ec2Role = this.createRole();

        const router1 = new RouteServer(this, 'ROUTER-1', {
            vpc: vpc,
            instanceName: 'ONPREM-ROUTER1',
            securityGroup: instanceSG,
            ec2Role: ec2Role,
            publicSubnet: subnetPub,
            privateENISubnet: subnetPrivate1
        });
        subnetPrivate1.addRoute('Route1AWSIPv4', {
            destinationCidrBlock: '10.16.0.0/16',
            routerType: RouterType.NETWORK_INTERFACE,
            routerId: router1.privateENI.ref
        });

        const router2 = new RouteServer(this, 'ROUTER-2', {
            vpc: vpc,
            instanceName: 'ONPREM-ROUTER2',
            securityGroup: instanceSG,
            ec2Role: ec2Role,
            publicSubnet: subnetPub,
            privateENISubnet: subnetPrivate2
        });
        subnetPrivate2.addRoute('Route2AWSIPv4', {
            destinationCidrBlock: '10.16.0.0/16',
            routerType: RouterType.NETWORK_INTERFACE,
            routerId: router2.privateENI.ref
        });


        // OnPremise Instances
        const onPremiseServer1 = new ec2.Instance(this, 'ONPREMSERVER1', {
            instanceName: 'ONPREMSERVER1',
            vpc: vpc,
            vpcSubnets: {subnets: [subnetPrivate1]},
            role: ec2Role,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux({generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,}),
            securityGroup: instanceSG
        });
        onPremiseServer1.node.addDependency(ssmVpcEndpoint, ssmMessagesEndpoint, ec2MessagesVpcEndpoint);

        // Route1AWSIPv4

        const onPremiseServer2 = new ec2.Instance(this, 'ONPREMSERVER2', {
            instanceName: 'ONPREMSERVER2',
            vpc: vpc,
            vpcSubnets: {subnets: [subnetPrivate2]},
            role: ec2Role,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux({generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,}),
            securityGroup: instanceSG
        });
        onPremiseServer2.node.addDependency(ssmVpcEndpoint, ssmMessagesEndpoint, ec2MessagesVpcEndpoint);


        new CfnOutput(this, 'Router1Public',
            {description: 'Public IP of Router1', value: router1.ec2Instance.instancePublicIp});

        new CfnOutput(this, 'Router2Public',
            {description: 'Public IP of Router2', value: router2.ec2Instance.instancePublicIp});

        new CfnOutput(this, 'Router1Private',
            {description: 'Private IP of Router1', value: router1.ec2Instance.instancePrivateIp});

        new CfnOutput(this, 'Router2Private',
            {description: 'Private IP of Router2', value: router2.ec2Instance.instancePrivateIp});

    }

    private createInstanceSecurityGroup(vpc: ec2.Vpc): ec2.SecurityGroup {
        // Security Group
        const instanceSG = new ec2.SecurityGroup(this, 'InstanceSG', {
            vpc: vpc,
            description: 'InstanceGS',
            securityGroupName: 'InstanceSG',
            allowAllOutbound: true,
        });
        instanceSG.addIngressRule(
            ec2.Peer.ipv4('10.16.0.0/16'),
            ec2.Port.allTraffic(),
            'Allow All from AWS Environment'
        );
        new ec2.CfnSecurityGroupIngress(this, 'InstanceSGSelfReferenceRule', {
            groupId: instanceSG.securityGroupId,
            ipProtocol: '-1',
            sourceSecurityGroupId: instanceSG.securityGroupId
        });
        return instanceSG;
    }

    private createRole(): iam.Role {
        const ec2Role = new iam.Role(this, 'EC2Role', {
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
        });
        ec2Role.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                resources: ['*'],
                actions: [
                    'ssm:DescribeAssociation',
                    'ssm:GetDeployablePatchSnapshotForInstance',
                    'ssm:GetDocument',
                    'ssm:DescribeDocument',
                    'ssm:GetManifest',
                    'ssm:GetParameter',
                    'ssm:GetParameters',
                    'ssm:ListAssociations',
                    'ssm:ListInstanceAssociations',
                    'ssm:PutInventory',
                    'ssm:PutComplianceItems',
                    'ssm:PutConfigurePackageResult',
                    'ssm:UpdateAssociationStatus',
                    'ssm:UpdateInstanceAssociationStatus',
                    'ssm:UpdateInstanceInformation',

                    'ssmmessages:CreateControlChannel',
                    'ssmmessages:CreateDataChannel',
                    'ssmmessages:OpenControlChannel',
                    'ssmmessages:OpenDataChannel',

                    'ec2messages:AcknowledgeMessage',
                    'ec2messages:DeleteMessage',
                    'ec2messages:FailMessage',
                    'ec2messages:GetEndpoint',
                    'ec2messages:GetMessages',
                    'ec2messages:SendReply',

                    's3:*', 'sns:*'
                ]
            })
        );

        return ec2Role;
    }
}
