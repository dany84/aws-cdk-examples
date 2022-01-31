import {Stack, StackProps} from 'aws-cdk-lib';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import {Construct} from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';

export class PrivateVpcWithTgwStack extends Stack {
    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // VPC
        const vpc = new ec2.Vpc(this, 'A4L-AWS', {
            cidr: '10.16.0.0/16',
            enableDnsSupport: true,
            enableDnsHostnames: true,
            maxAzs: 2,
            natGateways: 0,
            subnetConfiguration: []
        });

        // SUBNETs
        const subnetPrivateA = new ec2.PrivateSubnet(this, 'SubnetPrivateA', {
            vpcId: vpc.vpcId,
            cidrBlock: '10.16.32.0/20',
            availabilityZone: Stack.of(this).availabilityZones[0]
        });
        // known issue https://github.com/aws/aws-cdk/issues/5927#issuecomment-1008855877 and https://github.com/aws/aws-cdk/issues/4308#issuecomment-818247109
        subnetPrivateA.node.tryRemoveChild('RouteTableAssociation');
        subnetPrivateA.node.tryRemoveChild('RouteTable');


        const subnetPrivateB = new ec2.PrivateSubnet(this, 'SubnetPrivateB', {
            vpcId: vpc.vpcId,
            cidrBlock: '10.16.96.0/20',
            availabilityZone: Stack.of(this).availabilityZones[1],
        });

        // known issue https://github.com/aws/aws-cdk/issues/5927#issuecomment-1008855877 and https://github.com/aws/aws-cdk/issues/4308#issuecomment-818247109
        subnetPrivateB.node.tryRemoveChild('RouteTableAssociation');
        subnetPrivateB.node.tryRemoveChild('RouteTable');

        // Route Table
        const customRT = new ec2.CfnRouteTable(this, 'CustomRT', {
            vpcId: vpc.vpcId,
            tags: [{key: 'Name', value: 'A4L-AWS-RT'}]
        });

        // Transit Gateway
        const tgw = new ec2.CfnTransitGateway(this, 'TGW', {
            amazonSideAsn: 64512,
            description: 'A4LTGW',
            defaultRouteTableAssociation: 'enable',
            dnsSupport: 'enable',
            vpnEcmpSupport: 'enable'
        });

        const tgwVPC = new ec2.CfnTransitGatewayAttachment(this, 'TGWVPC', {
            transitGatewayId: tgw.ref,
            vpcId: vpc.vpcId,
            subnetIds: [subnetPrivateA.subnetId, subnetPrivateB.subnetId]
        });

        const tgwDefaultRoute = new ec2.CfnRoute(this, 'TGWDefaultRoute', {
            routeTableId: customRT.ref,
            transitGatewayId: tgw.ref,
            destinationCidrBlock: '0.0.0.0/0'
        });
        tgwDefaultRoute.node.addDependency(tgwVPC);

        const rtAssociationPrivateA = new ec2.CfnSubnetRouteTableAssociation(this, 'RTAssociationPrivateA', {
            routeTableId: customRT.ref,
            subnetId: subnetPrivateA.subnetId
        });

        const rtAssociationPrivateB = new ec2.CfnSubnetRouteTableAssociation(this, 'RTAssociationPrivateB', {
            routeTableId: customRT.ref,
            subnetId: subnetPrivateB.subnetId,
        });

        // Security Group
        const instanceSG = new ec2.SecurityGroup(this, 'InstanceSG', {
            vpc: vpc,
            description: 'Default A4L AWS SG',
            securityGroupName: 'InstanceSG',
            allowAllOutbound: true,
        });
        instanceSG.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow SSH IPv4 IN');
        instanceSG.addIngressRule(ec2.Peer.ipv4('192.168.8.0/21'), ec2.Port.allTraffic(), 'Allow ALL from ONPREM Networks');

        new ec2.CfnSecurityGroupIngress(this, 'InstanceSGSelfReferenceRule', {
            groupId: instanceSG.securityGroupId,
            ipProtocol: '-1',
            sourceSecurityGroupId: instanceSG.securityGroupId
        });

        // VPC endpoints

        const ssminterfaceendpoint = new ec2.InterfaceVpcEndpoint(this, 'ssminterfaceendpoint', {
            vpc: vpc,
            privateDnsEnabled: true,
            subnets: {subnets: [subnetPrivateA, subnetPrivateB]},
            securityGroups: [instanceSG],
            service: {
                name: `com.amazonaws.${Stack.of(this).region}.ssm`,
                port: 443
            }
        });

        const ssmec2messagesinterfaceendpoint = new ec2.InterfaceVpcEndpoint(this, 'ssmec2messagesinterfaceendpoint', {
            vpc: vpc,
            privateDnsEnabled: true,
            subnets: {subnets: [subnetPrivateA, subnetPrivateB]},
            securityGroups: [instanceSG],
            service: {
                name: `com.amazonaws.${Stack.of(this).region}.ec2messages`,
                port: 443
            }
        });

        const ssmmessagesinterfaceendpoint = new ec2.InterfaceVpcEndpoint(this, 'ssmmessagesinterfaceendpoint', {
            vpc: vpc,
            privateDnsEnabled: true,
            subnets: {subnets: [subnetPrivateA, subnetPrivateB]},
            securityGroups: [instanceSG],
            service: {
                name: `com.amazonaws.${Stack.of(this).region}.ssmmessages`,
                port: 443
            }
        });

        // Ec2 Instances


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

        const ec2A = new ec2.Instance(this, 'EC2A', {
            instanceName: 'EC2A',
            vpc: vpc,
            vpcSubnets: {subnets: [subnetPrivateA]},
            role: ec2Role,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux({generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,}),
            securityGroup: instanceSG
        });
        ec2A.node.addDependency(ssminterfaceendpoint, ssmec2messagesinterfaceendpoint, ssmmessagesinterfaceendpoint);

        const ec2B = new ec2.Instance(this, 'EC2B', {
            instanceName: 'EC2B',
            vpc: vpc,
            vpcSubnets: {subnets: [subnetPrivateA]},
            role: ec2Role,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux({generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,}),
            securityGroup: instanceSG
        });
        ec2B.node.addDependency(ssminterfaceendpoint, ssmec2messagesinterfaceendpoint, ssmmessagesinterfaceendpoint);
    }
}
